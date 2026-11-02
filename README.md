# Classroom Technology Observer

A small Google Apps Script web app backed by a Google Sheet. It provides a single-page interface for adding observations and browsing the read-only collection.

## Files

- `Code.gs` — server-side validation, duplicate detection, storage, and read-only data retrieval.
- `Index.html` — single-page add/browse interface.
- `appsscript.json` — Apps Script configuration.

## Setup

1. Create a new Google Apps Script project.
2. Replace the default code with `Code.gs`.
3. Add an HTML file named `Index` and paste in `Index.html`.
4. Add `appsscript.json` if desired; otherwise keep the generated manifest.
5. In the Apps Script editor, run `setup()` once and authorize it. This creates the backing Google Sheet.
6. Deploy as a web app: **Deploy → New deployment → Web app**.
7. Set the web app to execute as you and choose the appropriate access setting for your observers.
8. Share the resulting web-app URL.

## Interface

The app has three views on the same page:

- **Add individual tool** — enter tool, one or more user types, optional custom “Other” user, one example use case, and optional “Anything else helpful to know?” notes.
- **Add class structure** — enter a course subject and code, a course title, and one of five class structures, then save it with Add observation. Course text is accepted as entered.
- **Browse observations** — choose individual tools or class structures before any rows, search, or filters are shown.

The browser has no edit/delete controls. The Sheet remains the source of truth.

## Data

Both collections live in the same spreadsheet.

The `Individual Tools` tab stores individual tools:

- ID
- Timestamp
- Tool
- Used By
- Example Use Case
- Anything Else (optional)
- Hidden duplicate key

The duplicate key is used only on the server to prevent accidental exact duplicate tool submissions.

The `Class Structures` tab stores class ratings:

- ID
- Timestamp
- Course Code
- Course Title
- Class Structure (one of the five structure titles)

The same rating can be saved more than once. Each submission is a separate class.

### Editing and deleting observations

The web app intentionally does not provide edit or delete controls. The Google Sheet is the administrative copy of the data. Anyone you give **Editor** access to that Sheet can correct a row or delete an observation directly in the `Individual Tools` tab.

The Browse Observations view reads the Sheet each time it is opened or refreshed, so Sheet changes are reflected in the web app. Duplicate checking is also based on the current Tool / Used By / Example Use Case values in the Sheet, so editing an existing row will not leave a stale duplicate key behind.


### Browse refresh
The Browse Observations view includes a Refresh button. Use it after an authorized Google Sheet editor changes or deletes observations; the page reloads the current data from the Sheet without changing the active search or role filter.
