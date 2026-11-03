# Feature: Sign-in

The student pastes a CatChat API key. The code is in `src/catatui/auth.ts`.

With `catatui --sso`, the sign-in also offers MSU SSO in a browser. This flag is for tests only.

## Decisions

- MSU SSO does not work for students, because they do not have access to the CatChat app in Azure (error AADSTS50105). So SSO is off by default.
- `--sso` turns on SSO, so other persons can test it. The flag is not in the README. If SSO works for students, make it the default and remove the flag.
- SSO uses the LiteLLM native-app OAuth flow: code + PKCE S256, with a loopback redirect to `127.0.0.1`. The contract is at `<CATCHAT_API>/.well-known/litellm-cli-auth`. CatVibes uses the same flow (`src/main/auth/pkce.ts`).
- The flag controls only the sign-in menu. An SSO sign-in has a refresh token, so catatui renews it without the flag.
- At the first start, catatui opens the sign-in at once. The student does not type `/login`.
- The browser opens only after the student presses Enter, so the student can read the steps first.
- The steps tell the student to select the team "gsoc". This team is correct for all students.
- catatui sends the key to `/v1/models` before it saves the key. A bad key gives an error at sign-in, not at the first prompt.
- A pasted key has no refresh token. catatui treats it as valid for 180 days, the catchat-access maximum.

## Subtleties

- Over SSH, the browser is on a different computer, so the loopback redirect fails. The student pastes the final redirect URL from the browser.
- The key page (catchat-access) works only on the MSU network or the MSU VPN. The sign-in text says this.
- `cleanKey` removes smart quotes, spaces, zero-width characters, `export X_API_KEY=`, and `Bearer`. Text copied from a web page or a PDF often has these.
- If the student types a prompt before the sign-in, an `input` handler shows "Sign in to CatChat first" and puts `/login catchat` in the editor. pi shows an error with links to the pi docs in this case. The handler replaces the text that the student typed.
- After the sign-in, a `model_select` handler removes `/login catchat` from the editor.
- `/catchat reset` removes the key, the model list, and the saved CatChat model, then stops catatui. pi keeps these values in memory, so a restart is necessary.
