import { reminders } from '../server/reminder-services.mjs'
import { createDeliveryHandler, internalAuthorized } from '../server/reminder-internal.mjs'

export default createDeliveryHandler({
  authorized: request => internalAuthorized(request, process.env.CRON_SECRET),
  deliver: message => reminders.deliver(message),
})
