# Feature: MSU Context

The system prompt tells the model that the user is a student or an employee of Montana State University. The code is in `src/catatui/msu.ts`.

## Decisions

- The section is always on, in the CLI and in the desktop app.
- It gives the MSU links for the Schedule of Classes, the academic calendar, and the catalog. It tells the model not to make up MSU facts.
- The section does not include the NetID or other personal data.

## Class schedule search (not done)

- The Bozeman Schedule of Classes is an Oracle APEX app: `https://apexprod.msu.montana.edu/apex/r/esg/s_class_schedule_bz/class-schedule`. It is public, but "session state protection" refuses search values in the URL. A tool must copy the full APEX page submit, which can break at each APEX change.
- The Gallatin College schedule (`prodmyinfo.montana.edu/pls/bzagent/pk_wg_gcskcrse...`) accepts a simple POST, but it is only Gallatin College.
- Before catatui sends automated searches, ask the Registrar or UIT for a supported data source (an API or a data export) and for permission.
