# Mobile Demo Video (shot list and script)

The shot list and the voice script for the video of the phone app demo on the iPhone. The plan is in [mobile-demo.md](mobile-demo.md), and the app is in [mobile.md](mobile.md). This is card-19.

The recording and the voice need the human: the iPhone, the MSU sign-in, and the voice. The agents cannot record the video.

## Status of the features

Some shots need features that are not built yet. Each shot has one of these marks:

- **Built**: the app has it now.
- **Not built: card-15**: the mock tools in the chat. All 7 demo questions need them.
- **Not built: card-16**: the Classes screen and the class chat.
- **Not built: card-17**: the Advising chat with the plan card.
- **Not built: card-18**: the 7 demo questions as starter prompts in demo mode.

Before you record a shot, make sure that its card is in Done. Then do the shot one time without the recorder, and compare the answer with "The viewer must see".

## Open decisions (for the human)

Decide these before the recording. The script below uses the recommendation.

1. The length and who the video is for. Recommendation: 3 to 4 minutes, for students and staff. Cut shots 12 and 13 for a 2-minute version.
2. The "DEMO" badge in the video. Recommendation: show it. The data is mock data, and the badge tells the viewer this.
3. Question 2. The human's question is "What do I need on assignment B to maintain an A?". The mock student has no A in any class (CSCI 305 is a B, 83.7%). Do not change the mock data for this (card-12 keeps the two demos the same). Recommendation: ask "What do I need on HW5 to keep my B in CSCI 305?". The other choice is "...to get an A in CSCI 305?". Then the answer is that HW5 alone cannot give an A. That answer is correct, but it is a weak moment for a video.

## Setup

Do these steps before you record.

1. Build the demo version on the iPhone: in `mobile/`, run `flutter run --release --dart-define=CATAI_DEMO=true -d <iPhone>`. A release build has no debug banner and runs smoothly.
2. Connect the iPhone to the MSU network on campus, or to the MSU VPN. The sign-in and the CatChat answers need it.
3. Sign out of the app, so that shot 1 starts on the sign-in screen. Sign Out also deletes the old chats. Then sign in one time without the recorder, to make sure that the MSU account works, and sign out again.
4. Turn on Do Not Disturb (or a Focus with no notifications). Turn off the alarms and the timers.
5. Charge the iPhone to more than 80%, or connect it to power. Low Power Mode changes the screen.
6. Set the text size to the default (Settings > Display & Brightness > Text Size). Turn off Bold Text and Display Zoom.
7. Set Appearance to Light. Light mode shows better in a video and on a projector. Record shot 14 in Dark mode, as an extra (optional).
8. Choose the model in the model menu before shot 1, so that the default model answers. Use the same model for all shots.
9. Close the other apps. Turn the brightness up. Clean the screen if you film the phone with a camera.
10. Do the 7 questions one time before the recording. CatChat can be slow at busy hours. Record at a quiet time (for example in the morning).

Note: "today" in the mock data is 2026-11-03. The answers about this week (question 7) and the due dates use that date, not the real date. card-15 must give the model the mock date.

## How to record the iPhone screen

Recommendation: QuickTime on a Mac, with a cable. This gives a clean recording with no red recording mark in the status bar.

1. Connect the iPhone to the Mac with a cable. Unlock the iPhone and tap Trust if it asks.
2. On the Mac, open QuickTime Player. Select File > New Movie Recording.
3. Click the arrow next to the record button. Select the iPhone as the camera. For the microphone, select "None" (record the voice separately).
4. Click the record button. Do the shot on the iPhone. Click the stop button. Select File > Save.

The other method: the Screen Recording control on the iPhone.

1. Add Screen Recording to Control Center (Settings > Control Center), if it is not there.
2. Open Control Center and tap Screen Recording. The recording starts after 3 seconds.
3. To stop, tap the red mark at the top of the screen. The video goes to Photos.

The iPhone does not show the taps in a recording. Add a circle at each tap in the edit, or say the tap in the voice.

Record each shot as a separate clip. Wait 2 seconds before the first tap and after the last result. Then the edit has space for a cut.

## Voice

- Record the voice after the screen, on the Mac, in a quiet room. Read the voice text of each shot while the clip plays.
- The voice text is short on purpose. A model answer takes time to come: cut the wait in the edit, or speed it up 2 times. Do not cut the "Thinking..." line fully, so the viewer sees that a real model answers.
- Each tool answer is mock data. Say this one time, in shot 4.

## Shots

### Shot 1: Sign in with the MSU account (Built)

- Screen: the sign-in screen.
- Tap: "Sign in with your MSU account". Type the MSU NetID and the password on the MSU page. Tap "Create key".
- The viewer must see: the logo, the MSU sign-in page in the app, and then the chat screen with the model name in the top bar and the "DEMO" badge.
- Voice: "catai is CatChat on your phone. You sign in with your MSU account, the same as on the web."
- Edit: blur the NetID. Cut the password typing, or blur it. Do not show the key.

### Shot 2: A plain question, with a table and code (Built)

- Screen: a new chat.
- Type: `Make a table of the time complexity of bubble sort, merge sort, and quicksort. Then show merge sort in Python.`
- The viewer must see: "Thinking...", then the answer as it comes, a table, and a code block with the language name and a Copy button. Tap Copy on the code block.
- Voice: "Ask anything. Answers show tables and code, and Copy puts the code on the clipboard."

### Shot 3: The model menu (Built)

- Screen: the chat screen.
- Tap: the model name in the top bar. Drag the sheet up. Tap the same model again to close it.
- The viewer must see: the model names for students, the notes, and the check mark on the current model.
- Voice: "Choose the model for the task. Each model has a short note."
- Do not change the model here. The demo questions must use the same model.

### Shot 4: Question 1, the grade in a class (Not built: card-15, card-18)

- Screen: a new chat in demo mode. The note "Demo: the student data is mock data." shows.
- Tap: the starter prompt for the grade (card-18), or type: `What is my current grade in CSCI 305?`
- The viewer must see: what the app looked up (card-15), then the answer: 83.7%, a B. Homework is 85% and the midterm is 81%. The quizzes and the final exam have no grades yet. The model says one time that the data is mock data.
- Voice: "In demo mode, the app has mock student data. This is not a real student. Ask about your grade, and the model reads it from the class."

### Shot 5: Question 2, the score needed on one assignment (Not built: card-15, card-18)

- Screen: the same chat as shot 4 (a follow-up question shows that the chat remembers).
- Type: `What do I need on HW5: A small interpreter to keep my B?` (see "Open decisions", item 3).
- The viewer must see: HW5 is due 2026-11-13 and has 100 points. If HW5 is the next graded work, a score of 81 or more keeps the grade at 83% or more (a B). HW4 is submitted, but it has no grade yet, so the number can change.
- Voice: "Ask what you need on the next assignment. The model does the math with the grade weights from the syllabus."
- Check before you record: the model must use the weights (Homework 40, Midterm 20 of the graded 60). If it says a different number, look at the reason in the answer.

### Shot 6: Question 3, the professor of a class next fall (Not built: card-15, card-18)

- Screen: a new chat.
- Type: `Who is the professor for CSCI 491, the class that starts in Fall 2027?`
- The viewer must see: CSCI 491 Special Topics: Program Verification, Dr. Morgan Hale (mock). Fall 2027 is planned and not final.
- Voice: "Ask who teaches a class, also a class in a future term."

### Shot 7: Question 4, computer science classes next spring (Not built: card-15, card-18)

- Screen: a new chat.
- Type: `What computer science classes are offered in Spring 2027?`
- The viewer must see: a table with CSCI 460 Operating Systems, CSCI 468 Compilers, CSCI 440 Database Systems, CSCI 446 Artificial Intelligence, CSCI 476 Computer Security, and CSCI 482R Senior Capstone I, with days, times, seats, and instructors. CSCI 476 is full (0 seats). CSCI 440 has 6 seats.
- Voice: "See next term's classes before registration opens, with times and open seats."

### Shot 8: Question 5, vet school (Not built: card-15, card-18)

- Screen: a new chat.
- Type: `I want to get into vet school. What does Cascade Ridge College of Veterinary Medicine require, and what classes here help me to be a qualified applicant?`
- The viewer must see: the school is a mock school. A GPA of 3.2 or more (overall), and C or better in each required course. The required areas (biology, general and organic chemistry, biochemistry, physics, genetics, microbiology, statistics, composition) with the MSU course for each, for example BIOB 160 and BIOB 170, CHMY 141 and CHMY 143. 300 hours with a veterinarian and 200 hours with animals. The courses that the student has (for example WRIT 101, STAT 332, PHSX 220). The model sends the student to the MSU pre-veterinary advisor for a real application.
- Voice: "Plan for a goal after MSU. The model compares a school's requirements with MSU courses. This school is made up for the demo."

### Shot 9: Question 6, formal verification (Not built: card-15, card-18)

- Screen: a new chat.
- Type: `What classes and labs can I join that will help my career in formal verification?`
- The viewer must see: classes (for example CSCI 246, PHL 236 Logic in Spring 2027, CSCI 468 Compilers, and CSCI 491 Program Verification in Fall 2027). Labs: the Software Assurance Lab (Dr. Morgan Hale), the Logic and Automated Reasoning Group (Dr. Priya Raman), and the Secure Systems Lab (Dr. Ravi Menon), each with a contact and how undergraduates join.
- Voice: "Ask about a career. The model finds the classes and the research labs, and who to contact."

### Shot 10: Question 7, activities (Not built: card-15, card-18)

- Screen: a new chat.
- Type: `What activities are happening at Montana State this week?`
- The viewer must see: events from 2026-11-04 to 2026-11-07, for example Trivia night (Nov 4, Procrastinator Theatre), Resume review drop-in (Nov 5), Bobcats volleyball (Nov 6, Shroyer Gym), and the Hyalite Canyon day hike (Nov 7), with the times and the costs.
- Voice: "And life outside class: events, clubs, and recreation."

### Shot 11: Classes, grades and work due soon (Not built: card-16)

- Screen: the Classes screen.
- Tap: open Classes from the drawer.
- The viewer must see: the four classes (CSCI 305, CSCI 338, M 221, PHSX 222) with the grade so far, and the work due soon: Homework 9: Magnetic fields in PHSX 222 is late, and Quiz 5: Closures (CSCI 305) and WebWork 10: Basis and dimension (M 221) are due tomorrow. The term date "Last day to withdraw" (2026-11-06).
- Voice: "Classes shows all your classes, your grades, and what is due next."

### Shot 12: A class chat (Not built: card-16)

- Screen: the class chat of CSCI 305.
- Tap: CSCI 305 on the Classes screen. Type: `Explain closures, with the example from the lecture notes.`
- The viewer must see: the explanation from the week 10 notes, with the Racket example `(define (make-adder n) (lambda (x) (+ x n)))`.
- Voice: "Each class has its own study helper. It uses the course notes, and it follows the class rules on AI."

### Shot 13: Advising, a plan and "Send to advisor" (Not built: card-17)

- Screen: the Advising chat.
- Type: `Help me plan my classes for Spring 2027.` Then, when the model offers it: `Yes, send the plan to my advisor.`
- The viewer must see: a plan of about 15 credits with prerequisites that the student meets (for example CSCI 460, CSCI 468, CSCI 482R). The model does not plan CSCI 476, because it is full. The plan card with "Send to advisor", for Dr. Sam Lee (mock). Tap "Send to advisor", then the confirmation.
- Voice: "Advising checks your requirements and prerequisites, makes a plan, and sends it to your advisor after you approve it."

### Shot 14: Saved chats and Sign Out (Built)

- Screen: the drawer.
- Tap: the menu button at the top left. Show the saved chats from the shots before. Tap one chat to open it. Open the drawer again. Tap Sign Out, then confirm.
- The viewer must see: the list of chats with their names, an old chat that opens, and the sign-in screen after Sign Out.
- Voice: "Your chats stay on your phone. Sign Out removes your key and your chats, so the next student starts clean."
- End card (in the edit): the catai logo and "catai for Montana State University". Add the text "Demo with mock student data" if the video shows the "DEMO" badge.

## Edit

1. Put the clips in the order of the shots. Add the voice.
2. Speed up or cut the waits for the model answers. Keep about 1 second of "Thinking...".
3. Blur the NetID in shot 1. Do not show a key, a password, or a real student's data.
4. Add a circle at each tap, or add a short caption with the text that the presenter types.
5. Add captions of the voice text, for viewers with no sound and for accessibility.
6. Export at the iPhone screen size (portrait). For a projector, put the portrait video in the center of a 16:9 frame.
