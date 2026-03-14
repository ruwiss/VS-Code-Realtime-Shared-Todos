# Git Note

A clean and collaborative VS Code todo/notes extension powered by Firebase Realtime Database.

## Screenshot

![Git Note screenshot](./screenshot.png)

## Features

- Custom **Git Note** icon in the Activity Bar
- Native-style summary area at the top and a custom native-like todo list below
- Realtime sync with Firebase Realtime Database
- Project / bucket structure for multiple shared todo spaces
- Remembers the last selected project and restores it on startup
- Add, edit, complete, reopen, and delete todos
- See your friend's changes instantly
- Shows the last activity device name with date/time
- Sound notifications when a todo is added, deleted, completed, or updated

## Firebase setup

This project is intended for personal use, so the security setup is kept simple.

1. Create a Firebase project.
2. Enable **Realtime Database**.
3. For development / personal usage, temporarily use open rules:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

4. Copy your database URL.

## Database URL

The database URL is hardcoded in the source:

- `src/constants.ts`
- `https://xxxxx-default-rtdb.firebaseio.com`

So there is no need to enter it through the UI.

## Development

```bash
npm install
npm run compile
```

Then press `F5` to open the Extension Development Host.

## Usage

- Click the **Git Note** icon in the Activity Bar
- In **General**, you can see the active project, connection status, and last activity
- In **Todo List**, you get a more controlled native-like custom list
- Use the **Projects** button to view existing buckets
- Create a new project / bucket if needed
- The last selected project is saved and restored automatically
- Use the top `+` action to add a todo to the active project
- Todo text is shown in full in the list
- Use row actions to complete, edit, or delete todos

## Notes

- Device names are used as the visible identity in todo rows.
- The device name is automatically derived from the system hostname.
- Projects are stored under `git-note/buckets/<project>` in Firebase.
- For Windows/Linux compatibility, only letters, numbers, and `-` are kept, with a maximum of **15 characters**.

Notification sounds are bundled inside the extension and played through local system tools:

- macOS: `afplay`
- Windows: PowerShell beep
- Linux: `ffplay` fallback

## Turkish README

For Turkish documentation, see [README.tr.md](./README.tr.md).
