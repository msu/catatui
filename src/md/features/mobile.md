# Feature: Mobile App

A phone app for iOS and Android. The code is in `mobile/`. It is a Flutter project.

## Decisions

- The app is a CatChat chat client. A phone cannot run pi (pi needs Node and a project folder), so the app has no file tools, no sandbox, no modes, and no undo.
- The app talks to CatChat directly: `GET /v1/models` for the model list and `POST /v1/chat/completions` with `stream: true` for the answer.
- Flutter, because one code base makes the iOS app and the Android app.
- The app is named "catai", the same as the desktop app. The bundle id is `edu.montana.catai`.
- The endpoints, the default model, the preferred models, the hidden models, and the model notes are a copy of `src/catatui/config.ts` in `mobile/lib/config.dart`. Change the two files together.
- Sign-in has the same two options as catatui (see [sign-in.md](sign-in.md)):
  1. MSU SSO with CatChat App Connect. The app opens the `/connect` page in the system sign-in sheet (`flutter_web_auth_2`: ASWebAuthenticationSession on iOS, a Custom Tab on Android). The sheet is Safari or Chrome, so Paste, password AutoFill, and the MFA prompts work as in the browser. The redirect address is `http://127.0.0.1:53682/callback`. The sheet can stop only at an app address, so while the sheet is open, the app listens at the redirect address (`LoopbackForwarder` in `auth.dart`) and sends the redirect on to `catai://callback`. That closes the sheet, and the app reads the code. Then the app sends the code and the PKCE S256 verifier to `POST /connect/token`. App Connect needs no change.
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
- A new chat shows three starter prompts. With the keyboard up, the start screen scrolls so that the prompts stay above the message box. A tap puts the start of a question in the message box, and the student completes it.
- Model menu: a sheet that the student can drag up. The drag handle is in the list of the sheet. The handle of `showModalBottomSheet` is not a part of the sheet that changes size, so a drag up on it did nothing. Each row has a name for students (`modelNames` in `config.dart`), the note, and the CatChat id. The current model has a check mark and a highlight. The order is: the preferred models, then the other models, then the models for one special task (`specialistModels`).
- On iOS, Return on a hardware keyboard sends the message, and Shift+Return makes a new line. The screen keyboard is not changed: its Return key makes a new line. On Android the hardware Return key is not changed, because some screen keyboards send the same key event.
- Send and Stop give a light haptic tap.
- Drawer: New Chat, the saved chats, and Sign Out. Each chat has a menu button with Delete. A swipe to the left also deletes the chat. Sign Out asks first, then removes the key, the saved model, and all chats from the phone, so a different student starts clean.

## Demo mode

- Demo mode is for the demo with mock data (see [mobile-demo.md](mobile-demo.md)). It is off by default.
- It is a build setting, like `--demo-mode` on the desktop: `flutter run --dart-define=CATAI_DEMO=true` (the same option for `flutter build`). A student cannot turn it on in a normal build.
- In demo mode, the top bar and the drawer show a "DEMO" badge, and a new chat shows the note "Demo: the student data is mock data."
- Demo video: a tap on the DEMO badge (top bar of the chat and of Classes, and the drawer; not the badge on the plan card) plays a 43 s video of the demo in a popup (`demo_video.dart`, `video_player`). The video is `assets/demo/demo_video.mp4` (480 × 1172, H.264, no sound, captions in the video, 2.3 MB). It was recorded in the iPhone simulator on 2026-11-19 with the demo questions, Classes, and Advising; the key name in the drawer is blurred. A tap on the video pauses it; at the end, a tap plays it again. The full 2.5 minute video is in `tmp/demo-video/` (not in git). `integration_test/demo_video_test.dart` checks on a device that it plays.
- In demo mode, the starter prompts of a new chat are the seven demo questions (`demoQuestions` in `demo_tools.dart`), with names from the mock data. A tap puts the full question in the message box.
- `demoBuild` in `config.dart` reads the setting. `AppState.demo` has the value, so the tests can set it.

## Mock tools (demo mode)

The fake end points of the demo. Only in demo mode. See [mobile-demo.md](mobile-demo.md) for the decision.

- The app sends a `tools` list with each chat request (OpenAI function tools). The model answers with tool calls, the app runs each tool on the phone, sends the results back as `tool` messages, and asks again. At most 5 rounds for one question.
- The tools are in `mobile/lib/demo_tools.dart`. They read the JSON files in `mobile/assets/demo/`:
  - `catalog_search`: the sections of a term with instructors, seats, and course outlines. Filters: term, subject, course.
  - `vet_school_requirements`: the mock vet school, and the MSU courses for each requirement.
  - `formal_verification_paths`: classes, research labs, and other ways in.
  - `campus_activities`: events, clubs, and recreation. Filter: category.
  - `my_classes`: the student's classes with the grade so far, the work due soon, and the term dates.
  - `class_grades`: one class: the grade by category, the scale, and all assignments with scores.
  - `grade_needed`: the score on one open assignment that gives a target letter grade. The app does the arithmetic, not the model. It uses the desktop grade rule: the mean of the category percents by weight, for the categories with graded work.
  - `class_syllabus`: one class: instructor, weights, policies, schedule, and lecture notes.
  - `my_transcript`, `degree_requirements`, `student_profile`: the student's record, the status of each major requirement, and the contacts and balance.
  - `next_term_classes`: the Spring 2027 sections with seats and the student's prerequisite status.
  - `submit_plan`: sends a plan for one or more terms to the advisor (mock). See "Advising" below.
- Classes, as on the desktop: the drawer has "Classes" in demo mode. The screen (`mobile/lib/classes_screen.dart`) reads `classes.json` and shows the term, a card for each class (code, title, instructor, grade so far, next work due), the late work and the work due in the next two weeks, and the term dates. A tap on a class goes back to the chat and puts "In CSCI 305: " in the message box. There is no separate class chat: the chat with the mock tools answers questions about each class.
- Advising, as on the desktop:
  - The drawer has "Advising" in demo mode. It starts a new chat with "Help me plan my classes for Spring 2027." in the message box.
  - When the student agrees on a plan, the model calls `submit_plan`. The app does not send at once: the chat shows a plan card with each term, the course titles and credits, the warnings (a full class, a missing prerequisite, a class that is done or in progress), and the note. The student taps "Send to advisor" or "Not now". The model gets the result only after the tap.
  - The card stays in the chat with its status ("Sent to Dr. Sam Lee (mock). Confirmation PLAN-...", or "Not sent"), and the chat file saves it. Nothing leaves the phone: the advisor and the confirmation number are mock data.
  - Stop, a new chat, or a closed app while the card waits gives "Not sent". The model gets a result only after a tap on "Not now". The result says that the student chose not to send the plan yet and that it is not an error: with a shorter text, the model told the student that the plan "did not go through".
- `profile.json`, `advising.json`, and `classes.json` come from the desktop mock data. To make them again, run `node scripts/demo-data.ts` in the repository folder. Do not change them by hand.
- Each tool result starts with a "MOCK DATA" line. The demo system prompt tells the model to use the tools, to say one time that the data is mock data, and that "today" is the mock date 2026-11-03.
- The chat shows one small row for each tool call above the answer, for example "Looked up: catalog (Spring 2027, CSCI)". The rows are saved with the chat.
- The app does not save the tool results. A later question in the same chat makes the model call the tools again.
- Each date in a tool result has its weekday in a field "<key>_weekday" (`withWeekdays`), and the demo prompt gives "Tuesday, 2026-11-03". In the simulator check of 2026-11-19, the model calculated each weekday wrong without this field.
- The demo prompt tells the model to give the mock data note one time, after the lookups, and to write no text before a tool call. Before this, some answers had the note two times.
- The app removes empty lines at the start of an answer. The models often send empty lines before a tool call.
- The demo prompt tells the model to use the names of people, and "they" when it does not know a person's pronouns.
- The demo prompt tells the model to copy course codes exactly. In a check, it wrote "PHYSX 220" for PHSX 220.
- The stream parser accepts tool call arguments in parts (OpenAI) or as one object, and a call with no id.
- The mock student has no A in a class now (B, C+, B+, C). For the question "what do I need to keep an A", the tool answers for the target grade that the student names, and says if the target is not possible.

## Subtleties

- The catchat access pages work only on the MSU network or the MSU VPN. The sign-in screen says this.
- The key expires after 180 days and has no refresh token. If CatChat answers 401, the app shows the sign-in screen again.
- 14 days or less before the expiry, the chat screen shows a warning.
- Stop closes the HTTP connection at once. The app keeps the part of the answer that came. The stream is not an `async*` function, because such a stream stops only at its next `yield`.
- The app saves a chat after each complete answer, and after Stop.
- The sign-in sheet is ephemeral (`preferEphemeral`): it keeps no cookies, so a different student can sign in on the same phone, and iOS does not ask "catai wants to use ... to sign in". Password AutoFill still works.
- Before the sheet opens, the app sends one request to the catchat access page (`signInPageProblem` in `auth.dart`, 8 s limit). If the page does not answer, the app does not open the sheet, and the sign-in screen shows the error and the network note. Before, the sheet showed only the browser's own error page.
- iCloud Private Relay can stop the MSU page in the sheet, also on the MSU network: the sheet is Safari, and Safari sends the page through the relay. The app's own check does not use the relay, so it cannot see this problem. If the sheet does not load the MSU page, turn off Private Relay (Settings > [name] > iCloud > Private Relay), or turn off "Limit IP Address Tracking" for the Wi-Fi network. Found on the human's iPhone, 2026-11-19.
- iOS can close the app's listening socket while the app is in the background (Apple TN2277), for example while the student approves the sign-in in the Authenticator app. Each time the app is active again during a sign-in, it checks the listener at the redirect address, and starts it again if it is gone (`LoopbackForwarder.ensureListening`).
- Each error in a sign-in shows under the buttons. Before, an error that was not a `SignInError` stopped the spinner with no message.
- Close (or Cancel) in the sheet goes back to the sign-in screen with no error. The listener at the redirect address stops when the sheet closes.
- If the redirect port is in use, the sign-in shows an error instead of a crash.
- Before 2026-11-19 the sign-in was a web view in the app (card-9). A long press for Paste was hard to hit there, and password AutoFill did not show, so the app now uses the system sheet.

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

In the iPhone simulator (iOS 27.2) on the MSU network, 2026-11-19: the sign-in sheet opens the MSU Microsoft page (the address bar shows login.microsoftonline.com). The keyboard shows the Passwords AutoFill bar. One tap in a field shows Paste and AutoFill, and Paste puts the text in. Close goes back to the sign-in screen. The app listens on the redirect port only while the sheet is open. The full MSU sign-in in the sheet (password, MFA, "Create key", then the sheet closes and the chat screen opens) works.

On the human's iPhone, 2026-11-19: the full MSU sign-in in the sheet works with iCloud Private Relay off. With Private Relay on, the sheet did not load the MSU page.

## Not Tested

- On the iPhone: the sign-in build with `ensureListening` and `signInPageProblem` (built, not installed). A sign-in that goes to the Authenticator app and back.
- On the iPhone: sign-out and a new sign-in, the light theme, the side scroll of a wide table and a long code line, and a drag up on the model menu.
- On Android: the sign-in and the chat with the real CatChat. There is no release build (it needs a signing key).
- The pasted key sign-in with a real key.
- The automatic tests use a stand-in for CatChat. The sign-in sheet and the secure storage work only on a phone or a simulator, so those tests do not cover them. `test/sso_forwarder_test.dart` covers the listener at the redirect address.

## Run

- To get the packages, run `flutter pub get` in `mobile/`.
- To run the tests, run `flutter test` in `mobile/`. The tests use no model and no network.
- `CATAI_SHOTS=<folder> flutter test --update-goldens test/screens_test.dart` saves a picture of each screen in the folder.
- The Dart line length is 160 (`analysis_options.yaml`). To format, run `dart format .`.
- The Android build needs JDK 17 or 21. Java 27 is too new for Gradle 9.5. To set the JDK, run `flutter config --jdk-dir <folder>`.
- The first Android build takes about 10 minutes, because Gradle gets the NDK and CMake.
- To run the demo, add `--dart-define=CATAI_DEMO=true` to `flutter run` or `flutter build`.
- To run on a phone or a simulator, run `flutter run` in `mobile/`. An iPhone needs Xcode and a signing team (open `mobile/ios/Runner.xcworkspace`, target Runner, Signing & Capabilities).
