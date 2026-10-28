import { Prisma } from "@prisma/client"
import type { ReceivableListQuery } from "@/lib/validation"
import type { ReceivableOverview, ReceivableOverviewRow, ReceivableCurrencySummary } from "@/types/receivables"

// All amounts and filtering stay in Postgres numeric arithmetic. The same scoped
// set feeds the paginated rows, counts and per-currency summaries in one snapshot.
export function receivableOverviewSet(tenantId: string, visibleOrderIds: Prisma.Sql, today: string, q: ReceivableListQuery) {
  return Prisma.sql`WITH orders AS (
    SELECT o.id, o.title, o."customerName", r.currency FROM "OrderReceivable" r
    JOIN "SalesOrder" o ON o."tenantId"=r."tenantId" AND o.id=r."orderId"
    WHERE r."tenantId"=${tenantId} AND o.status='CONFIRMED' AND o.id IN (${visibleOrderIds})
  ), paid AS (
    SELECT a."lineId", sum(a.amount) AS amount FROM "OrderReceiptAllocation" a
    JOIN "OrderReceipt" p ON p."tenantId"=a."tenantId" AND p.id=a."paymentId" AND p."orderId"=a."orderId"
    WHERE a."tenantId"=${tenantId} AND p.status='POSTED' AND a."orderId" IN (SELECT id FROM orders) GROUP BY a."lineId"
  ), lines AS (
    SELECT o.*, l.amount, coalesce(p.amount,0) AS paid, l.amount-coalesce(p.amount,0) AS balance, l."dueOn", ${today}::date-l."dueOn" AS age
    FROM orders o JOIN "OrderReceivableLine" l ON l."tenantId"=${tenantId} AND l."orderId"=o.id LEFT JOIN paid p ON p."lineId"=l.id
  ), balances AS (
    SELECT id AS "orderId", title, "customerName", currency, sum(amount) AS total, sum(paid) AS paid, sum(balance) AS outstanding,
      coalesce(sum(balance) FILTER (WHERE age>0),0) AS overdue,
      coalesce(sum(balance) FILTER (WHERE age<=0),0) AS current,
      coalesce(sum(balance) FILTER (WHERE age IS NULL),0) AS unscheduled,
      coalesce(sum(balance) FILTER (WHERE age BETWEEN 1 AND 30),0) AS "days1to30",
      coalesce(sum(balance) FILTER (WHERE age BETWEEN 31 AND 60),0) AS "days31to60",
      coalesce(sum(balance) FILTER (WHERE age BETWEEN 61 AND 90),0) AS "days61to90",
      coalesce(sum(balance) FILTER (WHERE age>90),0) AS "days91plus",
      to_char(min("dueOn") FILTER (WHERE balance>0),'YYYY-MM-DD') AS "nextDue"
    FROM lines GROUP BY id,title,"customerName",currency
  ), filtered AS (
    SELECT * FROM balances WHERE (position(lower(${q.q}) in lower(title))>0 OR position(lower(${q.q}) in lower("customerName"))>0 OR position(lower(${q.q}) in lower("orderId"))>0)
    ${q.currency ? Prisma.sql`AND currency=${q.currency}` : Prisma.empty}
    ${q.status === "OPEN" ? Prisma.sql`AND outstanding>0` : q.status === "OVERDUE" ? Prisma.sql`AND overdue>0` : q.status === "SETTLED" ? Prisma.sql`AND outstanding=0` : Prisma.empty}
  )`
}
export async function readReceivableOverview(tx: Prisma.TransactionClient, tenantId: string, visibleOrderIds: Prisma.Sql, today: string, q: ReceivableListQuery): Promise<ReceivableOverview> {
  const cte = receivableOverviewSet(tenantId, visibleOrderIds, today, q)
  const sort = { overdue: Prisma.sql`filtered.overdue`, outstanding: Prisma.sql`filtered.outstanding`, nextDue: Prisma.sql`filtered."nextDue"`, title: Prisma.sql`filtered.title` }[q.sort]
  const direction = q.order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`
  // Reuse one scoped statement for the page, totals and choices. Replanning the
  // full RLS/source graph three times can exhaust the transaction even for a
  // small page; do not loosen the access predicates or the financial timeout.
  const [result] = await tx.$queryRaw<{ items: ReceivableOverviewRow[]; summaries: ReceivableCurrencySummary[]; currencies: string[] }[]>(Prisma.sql`${cte}, page AS (
    SELECT "orderId",title,"customerName",currency,total::text,paid::text,outstanding::text,overdue::text,"nextDue",${sort} AS "sortValue"
    FROM filtered ORDER BY ${sort} ${direction} NULLS LAST,"orderId" ASC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}
  ), summaries AS (
    SELECT currency,count(*)::int AS orders,sum(total)::text AS total,sum(paid)::text AS paid,sum(outstanding)::text AS outstanding,sum(overdue)::text AS overdue,sum(current)::text AS current,sum(unscheduled)::text AS unscheduled,sum("days1to30")::text AS "days1to30",sum("days31to60")::text AS "days31to60",sum("days61to90")::text AS "days61to90",sum("days91plus")::text AS "days91plus" FROM filtered GROUP BY currency
  ) SELECT
    coalesce((SELECT jsonb_agg(to_jsonb(p)-'sortValue' ORDER BY p."sortValue" ${direction} NULLS LAST,p."orderId" ASC) FROM page p),'[]'::jsonb) AS items,
    coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.currency) FROM summaries s),'[]'::jsonb) AS summaries,
    ARRAY(SELECT DISTINCT currency FROM orders ORDER BY currency) AS currencies`)
  const { items, summaries, currencies } = result
  const total = summaries.reduce((n, row) => n + row.orders, 0)
  for (const row of items) for (const key of ["total", "paid", "outstanding", "overdue"] as const) row[key] = new Prisma.Decimal(row[key]).toString()
  for (const row of summaries) for (const key of ["total", "paid", "outstanding", "overdue", "current", "unscheduled", "days1to30", "days31to60", "days61to90", "days91plus"] as const) row[key] = new Prisma.Decimal(row[key]).toString()
  return { items, summaries, currencies, today, total, page: q.page, pageSize: q.pageSize, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) }
}
