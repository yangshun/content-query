---
title: Getting started
description: Make a workspace and give your first project a home.
order: 1
---

## Start with a workspace

A workspace is a shared home for your projects. Create one for your team, a side project, or the work you do on your own.

1. Choose **New workspace** from the workspace menu.
2. Give it a short, recognizable name.
3. Create your first project. You can invite people later.

## Write the first note

Open your project and choose **New note**. Start with what you know: the problem, an idea worth trying, or a decision you need to make.

A useful first note answers three questions:

- What are we working toward?
- What do we know so far?
- What is the next small step?

Notes save as you write. There is no required template, and you can change the structure as the project takes shape.

## Set a few defaults

If you keep your workspace settings in a repository, add a `notebook.json` file at its root:

```json
{
  "workspace": "Studio notebook",
  "defaultProject": "Website refresh",
  "newNoteTemplate": "Context, decisions, and the next small step",
  "weekStartsOn": "monday"
}
```

Workspace settings apply to new projects. Existing notes stay as you left them.

Once you have a few notes, learn how to [organize your projects](/docs/organizing-projects).
