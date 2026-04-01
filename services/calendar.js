const { google } = require('googleapis');

function getCalendarClient() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

/**
 * Creates a calendar event and returns the event ID.
 */
async function createCalendarEvent({ customerName, phone, date, time }) {
  const calendar = getCalendarClient();

  // Build start/end datetime — appointments are 30 min by default
  const startDateTime = new Date(`${date}T${time}:00`);
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  const event = {
    summary: `Appointment — ${customerName}`,
    description: `Customer: ${customerName}\nPhone: ${phone}`,
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: 'Asia/Kolkata',
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: 'Asia/Kolkata',
    },
  };

  const response = await calendar.events.insert({
    calendarId: process.env.CALENDAR_ID,
    resource: event,
  });

  return response.data.id;
}

/**
 * Updates an existing calendar event to a new date/time.
 */
async function updateCalendarEvent({ eventId, newDate, newTime }) {
  const calendar = getCalendarClient();

  const startDateTime = new Date(`${newDate}T${newTime}:00`);
  const endDateTime = new Date(startDateTime.getTime() + 30 * 60 * 1000);

  await calendar.events.patch({
    calendarId: process.env.CALENDAR_ID,
    eventId,
    resource: {
      start: {
        dateTime: startDateTime.toISOString(),
        timeZone: 'Asia/Kolkata',
      },
      end: {
        dateTime: endDateTime.toISOString(),
        timeZone: 'Asia/Kolkata',
      },
    },
  });
}

/**
 * Deletes a calendar event.
 */
async function deleteCalendarEvent(eventId) {
  const calendar = getCalendarClient();
  await calendar.events.delete({
    calendarId: process.env.CALENDAR_ID,
    eventId,
  });
}

module.exports = { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent };
