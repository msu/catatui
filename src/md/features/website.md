# Feature: Website

The site is one static page in `docs/`, at https://catatui.cs.montana.edu. GitHub Pages publishes this folder from the master branch. The folder also holds the install scripts.

## Decisions

- The page uses plain HTML with inline styles. It has no build step.
- The only JavaScript is the copy button on the install commands, because students copy and paste these commands.
- The style follows `internal/tools/www` in csci-366-template, with some more styling.
- The page order is screenshot, install, then brief docs. The README holds the full docs.
- The page text uses the voice of the author, not STE. This is an exception to the STE rule.

## Subtleties

- `catatui.cs.montana.edu` is a CNAME to `msu.github.io`. MSU IT controls this DNS record. `docs/CNAME` holds the hostname for GitHub Pages.
- `docs/img/screenshot.png` is a real catatui screen. To make it, run catatui in a pty with a fake key, then render the screen to an image. It has no agent conversation, because a fake key cannot get a model response.
- Update the screenshot if the header, the footer, or the `/mode` panel changes. It shows the version number.
