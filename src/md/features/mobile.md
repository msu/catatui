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
- The thinking of the model is hidden. The app shows "Thinking..." until the answer starts.
- The system prompt is short: the assistant is CatChat for Montana State University students, and it gives the date.
- The app has the MSU light and dark themes (MSU blue and gold). It follows the phone setting.
- Each dependency version is exact.
- The app icon is `desktop/build/icon.png`, the same as the desktop app. `dart run flutter_launcher_icons` in `mobile/` makes the iOS and Android icons from it.
- The app uses the old material library (`package:flutter/material.dart`), because `flutter_markdown_plus` uses it. Flutter 3.47 moved the library to the `material_ui` package. Change the imports when `flutter_markdown_plus` changes.

## Screens

- Sign-in: the logo, "Sign in with your MSU account", and "Paste a key".
- Chat: the messages, the message box, Send (Stop while the answer comes), and the model name in the top bar. A tap on the model name opens the model menu with the notes.
- Drawer: New Chat, the saved chats (swipe left to delete), and Sign Out. Sign Out asks first, then removes the key, the saved model, and all chats from the phone, so a different student starts clean.

## Subtleties

- The catchat access pages work only on the MSU network or the MSU VPN. The sign-in screen says this.
- The key expires after 180 days and has no refresh token. If CatChat answers 401, the app shows the sign-in screen again.
- 14 days or less before the expiry, the chat screen shows a warning.
- Stop closes the HTTP connection at once. The app keeps the part of the answer that came. The stream is not an `async*` function, because such a stream stops only at its next `yield`.
- The app saves a chat after each complete answer, and after Stop.
- The SSO web view does not keep cookies after the sign-in, so a different student can sign in on the same phone.
- It is not confirmed that the Microsoft sign-in page works in a web view for all MSU accounts. The pasted key is the second option.

## Not Tested

- The app starts in the iPhone simulator (iOS 27.2) and in the Android emulator (API 36): the sign-in screen shows. It has not run on a real phone yet.
- The sign-in and the chat have not run with the real CatChat. The tests run the screens with a stand-in for CatChat.
- The SSO web view and the secure storage work only on a phone or a simulator, so the tests do not cover them.

## Run

- To get the packages, run `flutter pub get` in `mobile/`.
- To run the tests, run `flutter test` in `mobile/`. The tests use no model and no network.
- `CATAI_SHOTS=<folder> flutter test --update-goldens test/screens_test.dart` saves a picture of each screen in the folder.
- The Dart line length is 160 (`analysis_options.yaml`). To format, run `dart format .`.
- The Android build needs JDK 17 or 21. Java 27 is too new for Gradle 9.5. To set the JDK, run `flutter config --jdk-dir <folder>`.
- The first Android build takes about 10 minutes, because Gradle gets the NDK and CMake.
- To run on a phone or a simulator, run `flutter run` in `mobile/`. An iPhone needs Xcode and a signing team (open `mobile/ios/Runner.xcworkspace`, target Runner, Signing & Capabilities).
