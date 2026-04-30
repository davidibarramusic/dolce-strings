import React, { useState, useEffect, useRef } from 'react';
import { Music, Lock, Check, AlertCircle, Clock } from 'lucide-react';
import { supabase } from './supabase.js';

// =====================================================================
// CONFIGURATION
// =====================================================================
const STUDIO_CONFIG = {
  studioName: "Dolce Strings",
  studioSubtitle: "Fall Semester 2026 · Lesson Sign-Up",
  location: "Grace Baptist Church",
  semesterStart: "August 18, 2026",
  semesterEnd: "December 17, 2026",
  contactEmail: "davidibarramusic@gmail.com",
  logoUrl: "/dolce_strings_logo.png",
};

// Teaching windows by day (minutes-from-midnight). 15-min underlying grid.
const TEACHING_WINDOWS = {
  Mon: [
    { start: 16 * 60, end: 16 * 60 + 30 },        // 4:00–4:30 PM
    { start: 18 * 60, end: 20 * 60 + 30 },        // 6:00–8:30 PM
  ],
  Tue: [
    { start: 16 * 60, end: 20 * 60 + 30 },        // 4:00–8:30 PM
  ],
  Thu: [
    { start: 16 * 60, end: 18 * 60 },             // 4:00–6:00 PM
  ],
};

const DAYS_DISPLAYED = ['Mon', 'Tue', 'Thu'];
const DAY_NAMES_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' };

const DURATIONS = [
  { minutes: 30, label: '30 minutes' },
  { minutes: 45, label: '45 minutes' },
  { minutes: 60, label: '60 minutes' },
];

const GRID_INCREMENT = 15;
const ADMIN_PASSCODE = '1234'; // CHANGE THIS to a passcode only you know

// =====================================================================
// HELPERS
// =====================================================================
function formatTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatTimeRange(startMin, durationMin) {
  return `${formatTime(startMin)} – ${formatTime(startMin + durationMin)}`;
}

function getValidStartsForDuration(duration) {
  const valid = [];
  for (const day of DAYS_DISPLAYED) {
    for (const window of TEACHING_WINDOWS[day]) {
      for (let t = window.start; t + duration <= window.end; t += GRID_INCREMENT) {
        valid.push({ id: `${day}-${t}`, day, startMin: t });
      }
    }
  }
  return valid;
}

function conflictsWithBookings(day, startMin, duration, bookings) {
  const lessonEnd = startMin + duration;
  for (const booking of bookings) {
    if (booking.day !== day) continue;
    const bStart = booking.start_min;
    const bEnd = booking.start_min + booking.duration;
    if (startMin < bEnd && lessonEnd > bStart) return true;
  }
  return false;
}

// =====================================================================
// MAIN
// =====================================================================
export default function LessonSignup() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [parentName, setParentName] = useState('');
  const [studentName, setStudentName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [adminMode, setAdminMode] = useState(false);
  const pollRef = useRef(null);

  async function loadBookings() {
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .order('booked_at', { ascending: true });

    if (error) {
      console.error('Load bookings error:', error);
      setLoading(false);
      return;
    }
    setBookings(data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadBookings();
    pollRef.current = setInterval(loadBookings, 5000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function handleBook() {
    if (!parentName.trim() || !studentName.trim()) {
      setErrorMsg('Please enter both names.');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');

    // Re-check conflicts with fresh data
    await loadBookings();
    if (conflictsWithBookings(selectedSlot.day, selectedSlot.startMin, duration, bookings)) {
      setErrorMsg('Sorry — this time was just booked by another family. Please choose another slot.');
      setSubmitting(false);
      return;
    }

    const { data, error } = await supabase
      .from('bookings')
      .insert({
        day: selectedSlot.day,
        start_min: selectedSlot.startMin,
        duration: duration,
        parent_name: parentName.trim(),
        student_name: studentName.trim(),
      })
      .select()
      .single();

    if (error) {
      // Check if it's the overlap trigger
      if (error.message && error.message.includes('overlap')) {
        setErrorMsg('Sorry — this time was just booked by another family. Please choose another slot.');
        await loadBookings();
      } else {
        setErrorMsg('Could not save your booking. Please try again or contact David.');
        console.error('Booking error:', error);
      }
      setSubmitting(false);
      return;
    }

    setConfirmedBooking({
      day: data.day,
      startMin: data.start_min,
      duration: data.duration,
      parentName: data.parent_name,
      studentName: data.student_name,
    });
    setBookings(prev => [...prev, data]);
    setSelectedSlot(null);
    setParentName('');
    setStudentName('');
    setSubmitting(false);
  }

  async function handleAdminUnbook(bookingId) {
    if (!confirm('Remove this booking? Only do this if a parent has asked you to.')) return;
    const { error } = await supabase.from('bookings').delete().eq('id', bookingId);
    if (error) {
      alert('Could not remove booking: ' + error.message);
      return;
    }
    setBookings(prev => prev.filter(b => b.id !== bookingId));
  }

  const availableStarts = duration
    ? getValidStartsForDuration(duration).filter(
        slot => !conflictsWithBookings(slot.day, slot.startMin, duration, bookings)
      )
    : [];

  const startsByDay = {};
  for (const day of DAYS_DISPLAYED) {
    startsByDay[day] = availableStarts.filter(s => s.day === day);
  }

  function buildDayTimeline(day) {
    const items = [];
    const windows = TEACHING_WINDOWS[day];
    const dayBookings = bookings
      .filter(b => b.day === day)
      .sort((a, b) => a.start_min - b.start_min);

    for (let wi = 0; wi < windows.length; wi++) {
      const window = windows[wi];
      let cursor = window.start;
      for (const b of dayBookings) {
        if (b.start_min >= window.start && b.start_min < window.end) {
          if (b.start_min > cursor) {
            items.push({ kind: 'gap', startMin: cursor, endMin: b.start_min });
          }
          items.push({
            kind: 'booked',
            id: b.id,
            startMin: b.start_min,
            duration: b.duration,
            studentName: b.student_name,
            parentName: b.parent_name,
          });
          cursor = b.start_min + b.duration;
        }
      }
      if (cursor < window.end) {
        items.push({ kind: 'gap', startMin: cursor, endMin: window.end });
      }
      const nextWindow = windows[wi + 1];
      if (nextWindow) {
        items.push({ kind: 'closed', startMin: window.end, endMin: nextWindow.start });
      }
    }
    return items;
  }

  const totalMinutesAvailable = DAYS_DISPLAYED.reduce((sum, day) => {
    return sum + TEACHING_WINDOWS[day].reduce((s, w) => s + (w.end - w.start), 0);
  }, 0);
  const bookedMinutes = bookings.reduce((s, b) => s + b.duration, 0);
  const remainingMinutes = totalMinutesAvailable - bookedMinutes;

  return (
    <div className="min-h-screen w-full" style={{
      background: 'linear-gradient(180deg, #f5f1e8 0%, #ebe3d3 100%)',
      fontFamily: "'Cormorant Garamond', 'Georgia', serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Inter:wght@400;500;600&display=swap');
        body { margin: 0; }
        .sans { font-family: 'Inter', system-ui, sans-serif; }
        .slot-button { transition: all 0.2s ease; }
        .slot-button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(80, 40, 20, 0.15);
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-in { animation: fadeIn 0.4s ease-out; }
        .duration-card.selected {
          background: #1a1410 !important;
          color: #d4a574 !important;
          border-color: #1a1410 !important;
        }
      `}</style>

      <header style={{
        borderBottom: '1px solid #8b6f47',
        background: 'linear-gradient(180deg, #1a1410 0%, #2d2218 100%)',
        color: '#f5f1e8',
      }}>
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="flex items-center gap-3 mb-6">
            <span className="sans text-xs tracking-[0.3em] uppercase" style={{ color: '#d4a574' }}>
              {STUDIO_CONFIG.location}
            </span>
          </div>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div className="flex-shrink-0">
              <img
                src={STUDIO_CONFIG.logoUrl}
                alt="Dolce Strings"
                style={{
                  height: '160px',
                  width: 'auto',
                  filter: 'invert(1) brightness(1.1)',
                  display: 'block',
                }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            </div>
            <div className="md:text-right">
              <p className="text-2xl font-light italic" style={{ color: '#c9b896' }}>
                {STUDIO_CONFIG.studioSubtitle}
              </p>
              <div className="mt-3 sans text-sm tracking-wider" style={{ color: '#a89478' }}>
                {STUDIO_CONFIG.semesterStart} — {STUDIO_CONFIG.semesterEnd}
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-baseline gap-4 mb-6 flex-wrap">
          <span className="sans text-[10px] tracking-[0.3em] uppercase font-medium" style={{ color: '#8b6f47' }}>
            Step 1
          </span>
          <h2 className="text-3xl italic font-light" style={{ color: '#1a1410' }}>
            Choose your lesson length
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {DURATIONS.map(d => (
            <button
              key={d.minutes}
              onClick={() => { setDuration(d.minutes); setErrorMsg(''); }}
              className={`duration-card slot-button text-left p-6 rounded ${duration === d.minutes ? 'selected' : ''}`}
              style={{
                background: '#fdfaf2',
                border: '1px solid #c9b896',
                color: '#1a1410',
              }}
            >
              <div className="flex items-center justify-between">
                <div className="text-3xl italic font-light">{d.label}</div>
                <Clock size={20} style={{ opacity: 0.6 }} />
              </div>
            </button>
          ))}
        </div>
      </section>

      {duration && (
        <section className="max-w-6xl mx-auto px-6 pb-12 fade-in">
          <div className="flex items-baseline gap-4 mb-6 flex-wrap">
            <span className="sans text-[10px] tracking-[0.3em] uppercase font-medium" style={{ color: '#8b6f47' }}>
              Step 2
            </span>
            <h2 className="text-3xl italic font-light" style={{ color: '#1a1410' }}>
              Pick a start time
            </h2>
            <span className="sans text-xs ml-auto" style={{ color: '#5a4a35' }}>
              Showing times available for a {duration}-minute lesson
            </span>
          </div>

          {loading ? (
            <div className="text-center py-20" style={{ color: '#8b6f47' }}>Loading schedule…</div>
          ) : (
            <div className="grid gap-4" style={{
              gridTemplateColumns: `repeat(${DAYS_DISPLAYED.length}, minmax(0, 1fr))`,
            }}>
              {DAYS_DISPLAYED.map(day => {
                const timeline = buildDayTimeline(day);
                const availableForDay = startsByDay[day] || [];
                return (
                  <div key={day}>
                    <div className="text-center mb-4 pb-3" style={{ borderBottom: '1px solid #8b6f47' }}>
                      <div className="text-3xl italic font-light" style={{ color: '#1a1410' }}>
                        {DAY_NAMES_FULL[day]}
                      </div>
                      <div className="sans text-[10px] tracking-[0.2em] uppercase mt-1" style={{ color: '#8b6f47' }}>
                        {availableForDay.length} {availableForDay.length === 1 ? 'option' : 'options'}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {timeline.map((item, i) => {
                        if (item.kind === 'booked') {
                          return (
                            <button
                              key={`booked-${i}`}
                              disabled={!adminMode}
                              onClick={() => adminMode && handleAdminUnbook(item.id)}
                              className="slot-button w-full px-3 py-2 rounded text-left sans"
                              style={{
                                background: '#3d2f20',
                                border: '1px solid #3d2f20',
                                color: '#c9b896',
                                cursor: adminMode ? 'pointer' : 'not-allowed',
                              }}
                            >
                              {adminMode ? (
                                <>
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-medium">
                                      {formatTimeRange(item.startMin, item.duration)}
                                    </span>
                                    <Lock size={11} style={{ color: '#8b6f47' }} />
                                  </div>
                                  <div className="text-[10px] mt-0.5" style={{
                                    color: '#d4a574',
                                    fontFamily: 'Inter',
                                    fontSize: '10px'
                                  }}>
                                    {item.studentName} · {item.parentName} · {item.duration} min
                                  </div>
                                </>
                              ) : (
                                <div className="flex items-center justify-between">
                                  <span className="text-xs italic" style={{
                                    fontFamily: "'Cormorant Garamond', serif",
                                    fontSize: '14px',
                                    color: '#8b6f47'
                                  }}>
                                    Reserved
                                  </span>
                                  <Lock size={11} style={{ color: '#8b6f47' }} />
                                </div>
                              )}
                            </button>
                          );
                        }
                        if (item.kind === 'closed') {
                          // Blocked time is invisible to parents.
                          return null;
                        }
                        const gapStarts = availableForDay.filter(
                          s => s.startMin >= item.startMin && s.startMin + duration <= item.endMin
                        );
                        if (gapStarts.length === 0) return null;
                        return (
                          <div key={`gap-${i}`} className="space-y-2">
                            {gapStarts.map(slot => (
                              <button
                                key={slot.id}
                                onClick={() => { setSelectedSlot(slot); setErrorMsg(''); }}
                                className="slot-button w-full px-3 py-2 rounded text-left sans"
                                style={{
                                  background: '#fdfaf2',
                                  border: '1px solid #c9b896',
                                  color: '#3d2f20',
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium">
                                    {formatTime(slot.startMin)}
                                  </span>
                                  <span className="text-[10px] tracking-wider uppercase" style={{ color: '#8b6f47' }}>
                                    Open
                                  </span>
                                </div>
                                <div className="text-[10px] mt-0.5" style={{
                                  color: '#8b6f47',
                                  fontFamily: "'Cormorant Garamond', serif",
                                  fontSize: '12px'
                                }}>
                                  Ends at {formatTime(slot.startMin + duration)}
                                </div>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                      {availableForDay.length === 0 && (
                        <div className="text-center py-6 text-sm italic" style={{
                          color: '#8b6f47',
                          fontFamily: "'Cormorant Garamond', serif"
                        }}>
                          No {duration}-min openings remain
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <footer style={{ borderTop: '1px solid #c9b896' }} className="mt-8">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between flex-wrap gap-4">
          <div className="sans text-xs" style={{ color: '#8b6f47' }}>
            Questions? Contact David at <a href={`mailto:${STUDIO_CONFIG.contactEmail}`} className="underline">{STUDIO_CONFIG.contactEmail}</a>
          </div>
          <div className="sans text-xs italic" style={{ color: '#8b6f47', fontFamily: "'Cormorant Garamond', serif", fontSize: '15px' }}>
            {Math.floor(remainingMinutes / 60)}h {remainingMinutes % 60}m of teaching time remaining
          </div>
          <button
            onClick={() => {
              if (adminMode) setAdminMode(false);
              else {
                const pin = prompt('Studio passcode:');
                if (pin === ADMIN_PASSCODE) setAdminMode(true);
                else if (pin) alert('Incorrect passcode.');
              }
            }}
            className="sans text-[10px] tracking-widest uppercase"
            style={{ color: adminMode ? '#a04020' : '#8b6f47' }}
          >
            {adminMode ? '✓ Studio View · Click to Exit' : 'Studio'}
          </button>
        </div>
      </footer>

      {selectedSlot && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 fade-in"
          style={{ background: 'rgba(26, 20, 16, 0.7)' }}
          onClick={() => !submitting && setSelectedSlot(null)}
        >
          <div
            className="max-w-md w-full rounded-lg overflow-hidden shadow-2xl"
            style={{ background: '#fdfaf2' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-5" style={{ borderBottom: '1px solid #c9b896', background: '#1a1410' }}>
              <div className="sans text-[10px] tracking-[0.3em] uppercase mb-1" style={{ color: '#d4a574' }}>
                Reserve Your Time
              </div>
              <div className="text-2xl italic font-light" style={{ color: '#f5f1e8' }}>
                {DAY_NAMES_FULL[selectedSlot.day]}
              </div>
              <div className="text-lg font-light mt-1" style={{ color: '#c9b896' }}>
                {formatTimeRange(selectedSlot.startMin, duration)} · {duration} min
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="sans text-[10px] tracking-[0.2em] uppercase mb-2 block" style={{ color: '#8b6f47' }}>
                  Parent Name
                </label>
                <input
                  type="text"
                  value={parentName}
                  onChange={e => setParentName(e.target.value)}
                  disabled={submitting}
                  className="w-full px-3 py-2 rounded sans"
                  style={{ border: '1px solid #c9b896', background: '#fdfaf2', color: '#1a1410', outline: 'none' }}
                  placeholder="e.g. Sarah Johnson"
                />
              </div>
              <div>
                <label className="sans text-[10px] tracking-[0.2em] uppercase mb-2 block" style={{ color: '#8b6f47' }}>
                  Student Name
                </label>
                <input
                  type="text"
                  value={studentName}
                  onChange={e => setStudentName(e.target.value)}
                  disabled={submitting}
                  className="w-full px-3 py-2 rounded sans"
                  style={{ border: '1px solid #c9b896', background: '#fdfaf2', color: '#1a1410', outline: 'none' }}
                  placeholder="e.g. Emma Johnson"
                />
              </div>

              <div className="sans text-xs flex items-start gap-2 p-3 rounded" style={{ background: '#f5f1e8', color: '#5a4a35' }}>
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <div>
                  Once reserved, this time is yours for the semester. Changes can only be made by contacting David directly.
                </div>
              </div>

              {errorMsg && (
                <div className="sans text-xs p-3 rounded" style={{ background: '#fef2f2', color: '#991b1b' }}>
                  {errorMsg}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setSelectedSlot(null)}
                  disabled={submitting}
                  className="flex-1 px-4 py-3 rounded sans text-sm tracking-wider uppercase"
                  style={{ border: '1px solid #c9b896', color: '#5a4a35', background: 'transparent' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleBook}
                  disabled={submitting}
                  className="flex-1 px-4 py-3 rounded sans text-sm tracking-wider uppercase font-medium"
                  style={{ background: '#1a1410', color: '#d4a574' }}
                >
                  {submitting ? 'Reserving…' : 'Reserve Time'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmedBooking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 fade-in"
          style={{ background: 'rgba(26, 20, 16, 0.7)' }}
          onClick={() => setConfirmedBooking(null)}
        >
          <div
            className="max-w-md w-full rounded-lg overflow-hidden shadow-2xl text-center"
            style={{ background: '#fdfaf2' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-8" style={{ background: '#1a1410' }}>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-4" style={{ background: '#d4a574' }}>
                <Check size={24} style={{ color: '#1a1410' }} strokeWidth={3} />
              </div>
              <div className="sans text-[10px] tracking-[0.3em] uppercase mb-2" style={{ color: '#d4a574' }}>
                Reservation Confirmed
              </div>
              <div className="text-3xl italic font-light" style={{ color: '#f5f1e8' }}>
                {DAY_NAMES_FULL[confirmedBooking.day]}
              </div>
              <div className="text-xl font-light mt-1" style={{ color: '#c9b896' }}>
                {formatTimeRange(confirmedBooking.startMin, confirmedBooking.duration)}
              </div>
              <div className="sans text-xs tracking-wider uppercase mt-2" style={{ color: '#8b6f47' }}>
                {confirmedBooking.duration} minutes
              </div>
            </div>
            <div className="p-6 space-y-3">
              <p style={{ color: '#3d2f20' }}>
                Thank you, <span className="italic">{confirmedBooking.parentName}</span>.
              </p>
              <p className="sans text-sm" style={{ color: '#5a4a35' }}>
                {confirmedBooking.studentName}'s lesson time is reserved for the fall semester.
                David will be in touch before the first lesson.
              </p>
              <button
                onClick={() => { setConfirmedBooking(null); setDuration(null); }}
                className="w-full mt-4 px-4 py-3 rounded sans text-sm tracking-wider uppercase font-medium"
                style={{ background: '#1a1410', color: '#d4a574' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
