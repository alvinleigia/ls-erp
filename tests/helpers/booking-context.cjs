// Explicit captured headers for existing one-office synthetic API regressions.
// Native multi-office tests and UI drafts capture their own independent context.
async function bookingContext(db,tenantId,userId){
 const row=(await db.query('SELECT "creationOfficeId",version FROM "BusinessOfficePolicy" WHERE "tenantId"=$1 AND "userId"=$2',[tenantId,userId])).rows[0]
 return row?.creationOfficeId?{'x-office-id':row.creationOfficeId,'x-office-version':String(row.version)}:{}
}
module.exports={bookingContext}
