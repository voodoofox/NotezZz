# Google Play: listing, forms and steps

Everything to paste into Play Console for **NotezZz** (`com.flatvoxel.notezzz`).
The Play build differs from the APK on GitHub in two ways only: its
application id, and no self-updater / install-packages permission (Play
updates it). Build it with `bash scripts/build-play.sh`; the bundle lands in
`../releases/NotezZz-<version>-play.aab`.

## 1. Create the app

Play Console → **Create app**
- App name: **NotezZz: Sticky Notes**
- Default language: English (United States)
- App or game: **App** · Free or paid: **Free**
- Tick the declarations.

## 2. Store listing (Grow users → Store presence → Main store listing)

**App name** (30 max): `NotezZz: Sticky Notes`

**Short description** (80 max):
`Sticky notes on your phone that show up on your Windows desktop.`

**Full description** (4000 max):

```
NotezZz is a sticky-notes app for your phone and your Windows PC. Write a note on your phone, tap the pin, and it's waiting on your desktop, on top of everything, when you sit down.

• Pin on your phone, see it on your PC: a pinned note opens as a sticky window on Windows seconds later.
• Tuck a sticky against the screen edge when it's in the way; hover to peek, click to bring it back.
• Reminders: set a time, and your phone tells you while your PC brings the note up.
• Checklists, bullet lists, bold, italic and underline, drawings, photos and voice memos.
• Colours and pixel patterns for every note. Restyle any of them, or paint your own.
• Home-screen widgets for one note or your whole list.
• Share any note as an image.
• Light and dark, and themes you can share.

Your notes stay yours. NotezZz has no servers and no accounts. Notes are kept on your phone, and if you sign in with Google they sync through one folder in your own Google Drive. The app can only see the files it created there.

Free. No ads, no tracking.

Get the free Windows app at flatvoxel.com/notezzz.
```

**Graphics** (all in `play/assets/`):
- App icon: `icon-512.png` (512×512)
- Feature graphic: `feature-1024x500.png`
- Phone screenshots: `phone-1-list.png` … `phone-5-fullscreen.png` (1080×2160)

**Category**: Productivity · **Contact email**: your address · **Website**: https://flatvoxel.com/notezzz/

## 3. App content (Policy → App content)

| Form | Answer |
| --- | --- |
| Privacy policy | https://flatvoxel.com/notezzz/privacy.html |
| App access | **All functionality is available without special access** (signing in is optional) |
| Ads | **No, my app does not contain ads** |
| Content rating | Category **Utility, Productivity, Communication, or Other**. Every question **No** (no violence, no user-to-user interaction or content sharing inside the app, no location sharing, no purchases) |
| Target audience | **18 and over** (simplest; avoids the Families requirements). 13+ is also allowed |
| News app | No |
| Health, financial features, government, gambling | None / No |
| Advertising ID | **No** |
| Data safety | See below |

**Data safety**
- *Does your app collect or share any of the required user data types?* → **No**.
  Why that is accurate: notes, drawings, photos and voice memos stay on the
  phone or go to the user's **own Google Drive**, which Google's guidance
  exempts ("users directly upload data to their own cloud storage account…
  and your app never accesses the data": we never receive it). The Google
  account email is read on the phone to show which account is connected and
  never leaves it.
- *Does your app allow users to create an account?* → **No** (there is no
  NotezZz account; Google sign-in is only to reach the user's own Drive).

## 4. Google sign-in for the new app id (Google Cloud Console)

In the **same Google Cloud project** as the existing NotezZz clients (Drive's
`drive.file` access is per project, so another project couldn't see the notes):

1. APIs & Services → Credentials → **Create credentials → OAuth client ID → Android**.
2. Package name: `com.flatvoxel.notezzz`.
3. SHA-1: the **app signing key** certificate from Play Console → Test and
   release → **App integrity** → App signing (available after the first upload).
4. Optional, to try the Play build before Play has it: a second Android client
   with the same package and the **upload key** SHA-1
   `1D:77:76:50:09:FF:DF:52:69:E8:49:E1:6D:EC:8F:5D:92:BB:02:D8`.
5. OAuth consent screen: status must be **In production** (in Testing, only
   listed test users can sign in). Don't upload a logo there (it triggers
   Google's verification).

## 5. Closed test (required before production for new personal accounts)

1. Test and release → Testing → **Closed testing** → create a track.
2. App signing: accept **Play App Signing** (Google holds the app signing key;
   our keystore stays the upload key).
3. Upload `NotezZz-<version>-play.aab`, add release notes.
4. Testers: an email list (or a Google Group) with **at least 12** people.
   Countries: all.
5. Send review, roll out, share the **opt-in link**. Each tester opens it,
   joins, and installs from Play on a real phone.
6. Keep **12+ testers opted in for 14 days in a row**.
7. Dashboard → **Apply for production** → answer the questions about the
   test → after approval, create a Production release (same bundle or newer).

## 6. Each later release

`bash scripts/build-play.sh` after the usual version bump, then upload the
new bundle to the track (production, or closed testing first). Version codes
come from the version (0.42.1 → 42001) and only ever go up.
