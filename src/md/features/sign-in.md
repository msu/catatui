# Feature: Sign-in

The student pastes a CatChat API key. The code is in `src/ts/auth.ts`.

## Decisions

- MSU SSO does not work, because students do not have access to the CatChat app in Azure (error AADSTS50105). CatVibes has the SSO code (`src/main/auth/pkce.ts`), if RCI gives access later.
- At the first start, catatui opens the sign-in at once. The student does not type `/login`.
- The browser opens only after the student presses Enter, so the student can read the steps first.
- The steps tell the student to select the team "gsoc". This team is correct for all students.
- catatui sends the key to `/v1/models` before it saves the key. A bad key gives an error at sign-in, not at the first prompt.
- A pasted key has no refresh token. catatui treats it as valid for 180 days, the catchat-access maximum.

## Subtleties

- The key page (catchat-access) works only on the MSU network or the MSU VPN. The sign-in text says this.
- `cleanKey` removes smart quotes, spaces, zero-width characters, `export X_API_KEY=`, and `Bearer`. Text copied from a web page or a PDF often has these.
- If the student types a prompt before the sign-in, an `input` handler shows "Sign in to CatChat first" and puts `/login catchat` in the editor. pi shows an error with links to the pi docs in this case. The handler replaces the text that the student typed.
- After the sign-in, a `model_select` handler removes `/login catchat` from the editor.
- `/catchat reset` removes the key, the model list, and the saved CatChat model, then stops catatui. pi keeps these values in memory, so a restart is necessary.
