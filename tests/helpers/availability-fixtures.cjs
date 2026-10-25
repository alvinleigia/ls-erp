/* eslint-disable @typescript-eslint/no-require-imports */
const {runWithDatabaseActor}=require('../../lib/database-actor.ts')
const {checkStaffAppointmentAvailability}=require('../../modules/workforce/availability.ts')
// Existing schedule/availability scenarios explicitly run as their fixture's
// tenant administrator. The dedicated privacy suite tests unprivileged actors.
exports.checkAsAdministrator=(profile,start,end,tenant,db)=>runWithDatabaseActor(`${tenant}_admin`,()=>checkStaffAppointmentAvailability(profile,start,end,tenant,db))
