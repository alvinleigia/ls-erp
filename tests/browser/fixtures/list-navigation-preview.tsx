"use client"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useListState, ListBackLink, useListRouter } from "@/components/erp/list-navigation"
import { Pagination } from "@/components/erp/pagination"
import { useState } from "react"

export function ListNavigationPreview() {
  const path = usePathname(), router = useListRouter()
  const [pagination, setPagination] = useListState("fixture", "pagination", { pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useListState("fixture", "search", "", { resetPages: true })
  const [status, setStatus] = useListState("fixture", "status", "all", { resetPages: true })
  const [relatedPage, setRelatedPage] = useListState("related", "page", 1)
  const [tab, setTab] = useListState("fixture", "tab", "summary")
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(false), [total, setTotal] = useState(200), [resolved, setResolved] = useState(false)
  const load = (success: boolean, n: number) => { setLoading(true); setResolved(false); setTimeout(() => { setTotal(n); setResolved(success); setLoading(false) }, 50) }
  if (path.endsWith("/record")) return <><h1>Record</h1><label>Draft<input value={draft} onChange={e => setDraft(e.target.value)} /></label><ListBackLink href="/navigation-fixture">Back to list</ListBackLink><button onClick={() => router.push("/navigation-fixture")}>Save and return</button></>
  return <><h1>Navigation fixture</h1><label>Search<input value={search} onChange={e => setSearch(e.target.value)} /></label><label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option>all</option><option>open</option></select></label><output aria-label="current page">{pagination.pageIndex + 1}</output><output aria-label="page size">{pagination.pageSize}</output><button onClick={() => setPagination(p => ({ ...p, pageIndex: 4 }))}>Page 5</button><button onClick={() => setPagination(p => ({ ...p, pageIndex: 6 }))}>Page 7</button><button onClick={() => setPagination({ pageIndex: 0, pageSize: 10 })}>10 rows</button><button onClick={() => setTab("history")}>History tab</button><output aria-label="current tab">{tab}</output><button onClick={() => setRelatedPage(3)}>Related page 3</button><output aria-label="related page">{relatedPage}</output><Link href="/navigation-fixture/record">Open record</Link><Pagination page={pagination.pageIndex + 1} pageSize={pagination.pageSize} total={total} loading={loading} resolved={resolved} onPageChange={page => setPagination(p => ({ ...p, pageIndex: page - 1 }))} /><button onClick={() => load(true, 50)}>Load fewer records</button><button onClick={() => load(true, 0)}>Load empty records</button><button onClick={() => load(false, 0)}>Fail request</button></>
}
