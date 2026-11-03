# Feature: Sign-in

The sign-in menu has two options. The code is in `src/catatui/auth.ts`.

1. MSU SSO in a browser (CatChat App Connect). This is the default. catatui gets the key with no copy and paste.
2. The student makes a key at catchat access and pastes it. catatui shows the key steps only for this option.

## Decisions

- SSO uses CatChat App Connect on catchat-access: `GET /connect` in the browser, a loopback redirect to `127.0.0.1` with a code, then `POST /connect/token` with the code and the PKCE S256 verifier. The reply is a normal free key.
- The App Connect key expires after 180 days and has no refresh token. catatui saves `expires_at` as the expiry. After that, the student signs in again.
- Each App Connect sign-in makes a new key named `<username>_catatui` (then `-2`, `-3`). The student signs in with Microsoft and MFA each time.
- catatui does not send `team`, so the approval page preselects the Student team. Student is the correct team for students.
- catatui no longer uses the LiteLLM SSO flow (`/.well-known/litellm-cli-auth`). Students do not have access to that CatChat app in Azure (error AADSTS50105).
- At the first start, catatui opens the sign-in at once. The student does not type `/login`.
- The browser opens only after the student presses Enter, so the student can read the steps first.
- The paste steps tell the student to select the team "Student".
- catatui sends the key to `/v1/models` before it saves the key. A bad key gives an error at sign-in, not at the first prompt.
- A pasted key has no refresh token. catatui treats it as valid for 180 days, the catchat-access maximum.

## Subtleties

- After the redirect, the browser shows a page with the MSU colors and the bobcat logo, in light or dark mode. The logo is inline, so the page works with no network. A script removes the one-time code from the address bar.
- Over SSH, the browser is on a different computer, so the loopback redirect fails. The student pastes the final redirect URL from the browser.
- The key page (catchat-access) works only on the MSU network or the MSU VPN. The sign-in text says this.
- `cleanKey` removes smart quotes, spaces, zero-width characters, `export X_API_KEY=`, and `Bearer`. Text copied from a web page or a PDF often has these.
- If the student types a prompt before the sign-in, an `input` handler shows "Sign in to CatChat first" and puts `/login catchat` in the editor. pi shows an error with links to the pi docs in this case. The handler replaces the text that the student typed.
- After the sign-in, a `model_select` handler removes `/login catchat` from the editor.
- `/catchat logout` removes the key, the model list, and the saved CatChat model, then stops catatui. pi keeps these values in memory, so a restart is necessary. pi's `/logout` removes only the key. `/catchat reset` is the old name, and it still works.
- `/catchat login` types `/login catchat` in the editor, and the student presses Enter. pi has no public API to open the sign-in from an extension.
- At start, if the CatChat key expires in 14 days or less, catatui shows a warning that tells the student to run `/catchat login`. catatui reads `expires` from `auth.json`. App Connect keys and pasted keys have no refresh token.
