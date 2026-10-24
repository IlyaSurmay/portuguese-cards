import { createReminderHandler } from '../server/reminder-http.mjs'
import { configured, reminders } from '../server/reminder-services.mjs'

export default createReminderHandler({ reminders, configured, publicKey: () => process.env.WEB_PUSH_PUBLIC_KEY })
