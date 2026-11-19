# Feature: Mobile App

A phone app for iOS and Android. The code is in `mobile/`. It is a Flutter project.

## Decisions

- The app is a CatChat chat client. A phone cannot run pi (pi needs Node and a project folder), so the app has no file tools, no sandbox, no modes, and no undo.
- The app talks to CatChat directly: `GET /v1/models` for the model list and `POST /v1/chat/completions` with `stream: true` for the answer.
- Flutter, because one code base makes the iOS app and the Android app.
- The app is named "catai", the same as the desktop app. The bundle id is `edu.montana.catai`.
- The endpoints, the default model, the preferred models, the hidden models, and the model notes are a copy of `src/catatui/config.ts` in `mobile/lib/config.dart`. Change the two files together.
- Sign-in has the same two options as catatui (see [sign-in.md](sign-in.md)):
  1. MSU SSO with CatChat App Connect. The app shows the `/connect` page in a web view in the app. The redirect address is `http://127.0.0.1:53682/callback`. No server listens there: the app stops the web view when it goes to that address, and reads the code from it. Then the app sends the code and the PKCE S256 verifier to `POST /connect/token`.
  2. The student makes a key at catchat access and pastes it. `cleanKey` does the same clean-up as catatui.
- The app sends the key to `/v1/models` before it saves the key.
- The key is in the secure storage of the phone (Keychain on iOS, Keystore on Android), not in a file.
- The app sends the key name `catai-mobile` to App Connect, so the key is `<username>_catai-mobile`.
- The chats are JSON files in the app documents folder, one file for each chat. The chat name is the start of the first message.
- The answer shows as markdown. The app shows HTML in the answer as text.
- Tables: a wide table scrolls to the side. Before the app shows an answer, `fixTables` (`mobile/lib/markdown.dart`) repairs tables that the markdown package refuses: a divider row with a different number of columns than the header, and empty lines between the rows. Models write such tables, and they showed as raw text with `|`.
- Code blocks: a monospace font (Menlo on iOS, `monospace` on Android), the language name, and a Copy button. A long line scrolls to the side.
- Each complete answer has a Copy button below it. It copies the markdown text.
- The answer text is selectable with a long press (`SelectionArea`). The app does not use selectable text widgets in the answer: they take the drag, and then a wide table or a long code line does not scroll to the side.
- The thinking of the model is hidden. The app shows "Thinking..." until the answer starts.
- The system prompt is short: the assistant is CatChat for Montana State University students, and it gives the date.
- The app has the MSU light and dark themes (MSU blue and gold). It follows the phone setting.
- Each dependency version is exact.
- The app icon is `desktop/build/icon.png`, the same as the desktop app. `dart run flutter_launcher_icons` in `mobile/` makes the iOS and Android icons from it.
- The app uses the old material library (`package:flutter/material.dart`), because `flutter_markdown_plus` uses it. Flutter 3.47 moved the library to the `material_ui` package. Change the imports when `flutter_markdown_plus` changes.

## Screens

- Sign-in: the logo, "Sign in with your MSU account", and "Paste a key".
- Chat: the messages, the message box, Send (Stop while the answer comes), and the model name in the top bar. A tap on the model name opens the model menu.
- A new chat shows three starter prompts. A tap puts the start of a question in the message box, and the student completes it.
- Model menu: a sheet that the student can drag up. The drag handle is in the list of the sheet. The handle of `showModalBottomSheet` is not a part of the sheet that changes size, so a drag up on it did nothing. Each row has a name for students (`modelNames` in `config.dart`), the note, and the CatChat id. The current model has a check mark and a highlight. The order is: the preferred models, then the other models, then the models for one special task (`specialistModels`).
- On iOS, Return on a hardware keyboard sends the message, and Shift+Return makes a new line. The screen keyboard is not changed: its Return key makes a new line. On Android the hardware Return key is not changed, because some screen keyboards send the same key event.
- Send and Stop give a light haptic tap.
- Drawer: New Chat, the saved chats, and Sign Out. Each chat has a menu button with Delete. A swipe to the left also deletes the chat. Sign Out asks first, then removes the key, the saved model, and all chats from the phone, so a different student starts clean.

## Demo mode

- Demo mode is for the demo with mock data (see [mobile-demo.md](mobile-demo.md)). It is off by default.
- It is a build setting, like `--demo-mode` on the desktop: `flutter run --dart-define=CATAI_DEMO=true` (the same option for `flutter build`). A student cannot turn it on in a normal build.
- In demo mode, the top bar and the drawer show a "DEMO" badge, and a new chat shows the note "Demo: the student data is mock data."
- `demoBuild` in `config.dart` reads the setting. `AppState.demo` has the value, so the tests can set it.

## Subtleties

- The catchat access pages work only on the MSU network or the MSU VPN. The sign-in screen says this.
- The key expires after 180 days and has no refresh token. If CatChat answers 401, the app shows the sign-in screen again.
- 14 days or less before the expiry, the chat screen shows a warning.
- Stop closes the HTTP connection at once. The app keeps the part of the answer that came. The stream is not an `async*` function, because such a stream stops only at its next `yield`.
- The app saves a chat after each complete answer, and after Stop.
- The SSO web view does not keep cookies after the sign-in, so a different student can sign in on the same phone.
- If the SSO page gives an error, or does not start to show in 20 seconds, the app shows the error with the network note and a "Try Again" button. Before this, the page showed only the progress bar when the phone was not on the MSU network.
- The page load does not wait for the cookie removal for more than 2 seconds.
- The SSO web view gets all gestures (`EagerGestureRecognizer`). With the default, a long press can go to Flutter, and the Paste menu does not open in the password field.
- The MSU sign-in page loads in the web view in the iPhone simulator (`integration_test/sso_test.dart`). The full sign-in works on one iPhone with one MSU account. It is not confirmed for all MSU accounts. The pasted key is the second option.

## Not Done

From the on-device review of 2026-11-18 (`tmp/ui-review-mirror-2026-11-18.md`):

- Rename of a chat. The chat name is the start of the first message.
- The model name with each old answer. The chat file does not keep the model.

## Tested

On an iPhone 14 Pro Max (iOS 27.0.1) on the MSU network, 2026-11-18:

- The MSU SSO sign-in in the web view, with "Create key": the chat screen opens.
- Chat with streaming, the model list, Stop (the part of the answer stays), and "Thinking...".
- Tables, code blocks with Copy (the clipboard has the code), the model menu content, Return and Shift+Return on a hardware keyboard.

In the iPhone simulator (iOS 27.2) and the Android emulator (API 36): the app starts, and the sign-in screen shows.

## Not Tested

- On the iPhone: Paste with a long press in the password field, sign-out and a new sign-in, the light theme, the side scroll of a wide table and a long code line, and a drag up on the model menu.
- On Android: the sign-in and the chat with the real CatChat. There is no release build (it needs a signing key).
- The pasted key sign-in with a real key.
- The automatic tests use a stand-in for CatChat. The SSO web view and the secure storage work only on a phone or a simulator, so those tests do not cover them.

## Run

- To get the packages, run `flutter pub get` in `mobile/`.
- To run the tests, run `flutter test` in `mobile/`. The tests use no model and no network.
- `flutter test integration_test/sso_test.dart -d <device>` opens the real App Connect page in the SSO web view. It needs a phone or a simulator on the MSU network.
- `CATAI_SHOTS=<folder> flutter test --update-goldens test/screens_test.dart` saves a picture of each screen in the folder.
- The Dart line length is 160 (`analysis_options.yaml`). To format, run `dart format .`.
- The Android build needs JDK 17 or 21. Java 27 is too new for Gradle 9.5. To set the JDK, run `flutter config --jdk-dir <folder>`.
- The first Android build takes about 10 minutes, because Gradle gets the NDK and CMake.
- To run the demo, add `--dart-define=CATAI_DEMO=true` to `flutter run` or `flutter build`.
- To run on a phone or a simulator, run `flutter run` in `mobile/`. An iPhone needs Xcode and a signing team (open `mobile/ios/Runner.xcworkspace`, target Runner, Signing & Capabilities).
