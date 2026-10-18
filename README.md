# The Glitchcore Chronicle

You are helping me build a long-term personal application called **The Glitchcore Chronicle**.

This is NOT a notes app.

This is NOT a clone of Notion.

This is NOT a clone of Obsidian.

This is a **personal digital chronicle**.

The goal is to become the place where I record my life, projects, thoughts, ideas, milestones, and memories.

The application should feel like something I own, not like generic productivity software.

---

# Design Philosophy

The UI must feel:

* Glitchcore
* Calm
* Premium
* Personal

Avoid:

* Bright colors
* Material Design look
* Windows 11 copies
* macOS copies
* Generic productivity app layouts

This should feel like opening a private archive.

---

# Technical Stack

Electron

HTML

CSS

Vanilla JavaScript (ES Modules)

No frameworks.

No React.

No Vue.

No build system.

Everything modular.

---

## Existing Modules Reused from ESM

To speed up development, a small number of modules have been copied from a previous project called **ESM (Employee Status Monitor)**.

These files are **not dependencies** and **Chronicle does not rely on ESM**. They are simply starting points because their architecture is already solid.

The imported modules are:

* `settings.js`
* `notificationcenter.js`
* `notificationmanager.js`

Treat these as native Chronicle modules.

Requirements:

* Remove every trace of STS, Amazon Relay, ESM, work-related terminology, and employee-specific logic.
* Keep only the reusable architecture and implementation patterns.
* Restyle the UI completely to match **The Glitchcore Chronicle**.
* Rename functions, variables, and internal structures where appropriate so they feel like they were originally written for Chronicle.
* If a piece of code no longer fits Chronicle's purpose, refactor or replace it instead of forcing compatibility.
* From this point onward, these files belong to Chronicle and should evolve independently from ESM.

---

# Development Rules

Work in milestones.

Never rewrite previous work.

Keep the architecture modular.

Every feature should be expandable later.

Use localStorage for persistence.

DO NOT use Firebase (except if absolutely necessary, which if it is you should tell me before you proceed).

DO NOT require cloud storage.

Everything should work completely offline.

---

# Milestone 1

Foundation

Create:

## Application Shell

Window

Sidebar

Main content area

Header

Search bar (placeholder)

A dock that shows the most used apps (like the recents menu from phones)

Footer

---

## Sidebar Sections

🏠 Home

📖 Entries

🧠 Brain Dump

⭐ Milestones

💡 Ideas

📅 Timeline

🔍 Search

⚙ Settings

Only navigation.

No functionality yet.

---

## Home Page

Display:

Current date and time (In Syria's Timezone, using IANA)

Greeting

Recent entries placeholder

Today's mood placeholder

"On This Day" placeholder

Statistics placeholder

---

## Theme

Create a design system using CSS variables.

Colors:

Deep purple

Electric violet

Muted gray

Soft white text

Use glassmorphism sparingly.

And allow using any picture (jpg or png) as a background.

---

# Milestone 2

Journal Entries

Create:

Rich text editor

Autosave

Create entry

Edit entry

Delete entry

Archive entry

Search entries

Each entry contains:

Title

Date

Mood

Tags

Body

Store locally.

---

# Milestone 3

Brain Dump

A dedicated space for quick thoughts.

Requirements:

No title required.

Just type.

Autosave.

Fast.

Searchable.

Separate from journal entries.

---

# Milestone 4

Milestones

Create a special section for important life events.

Examples:

Finished ESM

Built first GlitchOS version

Bought new phone

Reached Gold

Started new job

Milestones have:

Title

Date and time (auto filled from when user starts typing)

Description (optional)

Tags (also optional but recommended)

---

# Milestone 5

Ideas

Store:

Coding ideas

Music ideas

Random thoughts

Future plans

Everything searchable.

---

# Milestone 6

Timeline

Chronological history.

Browse by:

Year

Month

Day

Clicking a day opens everything recorded that day.

---

# Milestone 7

Search

One global search.

Searches:

Entries

Brain Dump

Ideas

Milestones

Tags

Results grouped by category.

---

# Milestone 8

On This Day

Every day the application should automatically display previous entries recorded on the same date in earlier years.

Example:

"One year ago today..."

---

# Tags

Support tags like:

Coding

Work

Gaming

Music

Personal

Faith

Projects

Ideas

Random

Custom tags should also be allowed.

---

# Mood System

Support simple moods:

😁 Great

🙂 Good

😐 Neutral

😕 Bad

😭 Terrible

No analytics yet.

Just store the selected mood.

---

# Important Philosophy

Nothing is ever permanently deleted.

Everything is archived.

The application should become a timeline of my life.

It should feel like opening a private digital journal that grows with me over many years.

---

# Context Tracker

At the end of every milestone output:

Current milestone

Completed milestones

Architecture

Files created

Files modified

Features working

Known issues

Next milestone

Future roadmap

Technical debt

And of course, the files you completed.

---

IMPORTANT:

Implement ONE milestone at a time (7 files each go, then output them and continue on the next).

After each completed milestone, STOP.

Wait for confirmation before continuing.

Never jump ahead.

Never redesign previous work.

Treat this as a professional long-term software project.
