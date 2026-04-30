# Dolce Strings — Lesson Sign-Up

A first-come, first-served lesson booking app for Dolce Strings violin studio.

## Environment Variables

This app needs two environment variables to connect to Supabase:

- `VITE_SUPABASE_URL` — your Supabase project URL
- `VITE_SUPABASE_KEY` — your Supabase publishable key

Set these in your Vercel project settings under Environment Variables.

## Studio Passcode

The "Studio" button in the footer requires a passcode to access admin view (where you can see who booked what and remove bookings if needed).

Default passcode is `4329` — change it in `src/LessonSignup.jsx` (search for `ADMIN_PASSCODE`).

## Customizing the schedule

Open `src/LessonSignup.jsx` and edit `TEACHING_WINDOWS` near the top of the file.
