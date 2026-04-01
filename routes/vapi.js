const express = require('express');
const router = express.Router();
const supabase = require('../services/supabase');
const { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } = require('../services/calendar');

/**
 * VAPI sends ALL tool calls to POST /vapi/tool
 * Body shape:
 * {
 *   message: {
 *     type: "tool-calls",
 *     toolCallList: [
 *       {
 *         id: "call_xxx",
 *         function: {
 *           name: "bookAppointment",
 *           arguments: { customerName, phone, date, time }
 *         }
 *       }
 *     ]
 *   }
 * }
 */
router.post('/tool', async (req, res) => {
  try {
    const toolCallList = req.body?.message?.toolCallList;

    if (!toolCallList || toolCallList.length === 0) {
      return res.status(400).json({ error: 'No tool calls found in request' });
    }

    // Process all tool calls (usually just one at a time)
    const results = await Promise.all(
      toolCallList.map(async (toolCall) => {
        const { id, function: fn } = toolCall;
        const { name, arguments: args } = fn;

        let result;

        switch (name) {
          case 'bookAppointment':
            result = await handleBook(args);
            break;
          case 'rescheduleAppointment':
            result = await handleReschedule(args);
            break;
          case 'cancelAppointment':
            result = await handleCancel(args);
            break;
          default:
            result = { success: false, message: `Unknown function: ${name}` };
        }

        return {
          toolCallId: id,
          result: JSON.stringify(result),
        };
      })
    );

    // VAPI expects this exact shape back
    return res.json({ results });

  } catch (err) {
    console.error('Tool handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── BOOK ────────────────────────────────────────────────────────────────────

async function handleBook({ customerName, phone, date, time }) {
  // Validate we have everything
  if (!customerName || !date || !time) {
    return {
      success: false,
      message: 'Missing required fields. I need your name, preferred date, and time.',
    };
  }

  // Check for duplicate booking (same name + date + time)
  const { data: existing } = await supabase
    .from('appointments')
    .select('id')
    .eq('name', customerName)
    .eq('date', date)
    .eq('time', time)
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      message: `You already have an appointment on ${date} at ${time}. Would you like to reschedule or cancel it instead?`,
    };
  }

  // Create Google Calendar event
  let calendarEventId = null;
  try {
    calendarEventId = await createCalendarEvent({ customerName, phone, date, time });
  } catch (calErr) {
    console.error('Calendar error (non-fatal):', calErr.message);
    // Don't fail the whole booking if Calendar fails — just log it
  }

  // Save to Supabase
  const { error } = await supabase.from('appointments').insert({
    name: customerName,
    phone: phone || null,
    date,
    time,
    calendar_event_id: calendarEventId,
    reminded: false,
  });

  if (error) {
    console.error('Supabase insert error:', error);
    return {
      success: false,
      message: 'Sorry, I was unable to save your appointment. Please try again.',
    };
  }

  return {
    success: true,
    message: `Your appointment has been booked for ${formatDate(date)} at ${formatTime(time)}. We'll send a reminder before your appointment. See you then!`,
  };
}

// ─── RESCHEDULE ───────────────────────────────────────────────────────────────

async function handleReschedule({ customerName, newDate, newTime }) {
  if (!customerName || !newDate || !newTime) {
    return {
      success: false,
      message: 'I need your name, new date, and new time to reschedule.',
    };
  }

  // Find the most recent upcoming appointment for this customer
  const { data: appointment, error: fetchError } = await supabase
    .from('appointments')
    .select('*')
    .eq('name', customerName)
    .gte('date', new Date().toISOString().split('T')[0]) // only future appointments
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchError || !appointment) {
    return {
      success: false,
      message: `I couldn't find an upcoming appointment for ${customerName}. Could you double-check the name?`,
    };
  }

  // Update Google Calendar
  if (appointment.calendar_event_id) {
    try {
      await updateCalendarEvent({
        eventId: appointment.calendar_event_id,
        newDate,
        newTime,
      });
    } catch (calErr) {
      console.error('Calendar update error (non-fatal):', calErr.message);
    }
  }

  // Update Supabase
  const { error: updateError } = await supabase
    .from('appointments')
    .update({ date: newDate, time: newTime, reminded: false })
    .eq('id', appointment.id);

  if (updateError) {
    console.error('Supabase update error:', updateError);
    return {
      success: false,
      message: 'Sorry, I was unable to reschedule your appointment. Please try again.',
    };
  }

  return {
    success: true,
    message: `Done! Your appointment has been moved to ${formatDate(newDate)} at ${formatTime(newTime)}. See you then!`,
  };
}

// ─── CANCEL ───────────────────────────────────────────────────────────────────

async function handleCancel({ customerName }) {
  if (!customerName) {
    return {
      success: false,
      message: 'I need your name to cancel your appointment.',
    };
  }

  // Find the most recent upcoming appointment
  const { data: appointment, error: fetchError } = await supabase
    .from('appointments')
    .select('*')
    .eq('name', customerName)
    .gte('date', new Date().toISOString().split('T')[0])
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchError || !appointment) {
    return {
      success: false,
      message: `I couldn't find an upcoming appointment for ${customerName}. Could you double-check the name?`,
    };
  }

  // Delete from Google Calendar
  if (appointment.calendar_event_id) {
    try {
      await deleteCalendarEvent(appointment.calendar_event_id);
    } catch (calErr) {
      console.error('Calendar delete error (non-fatal):', calErr.message);
    }
  }

  // Delete from Supabase
  const { error: deleteError } = await supabase
    .from('appointments')
    .delete()
    .eq('id', appointment.id);

  if (deleteError) {
    console.error('Supabase delete error:', deleteError);
    return {
      success: false,
      message: 'Sorry, I was unable to cancel your appointment. Please try again.',
    };
  }

  return {
    success: true,
    message: `Your appointment on ${formatDate(appointment.date)} at ${formatTime(appointment.time)} has been cancelled. Hope to hear from you again soon!`,
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function formatDate(dateStr) {
  // "2026-04-15" → "April 15th, 2026"
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function formatTime(timeStr) {
  // "14:30" → "2:30 PM"
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${period}`;
}

module.exports = router;
