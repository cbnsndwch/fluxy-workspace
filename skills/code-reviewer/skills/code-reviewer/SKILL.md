---
name: code-reviewer
description: Reviews code changes, provides suggestions for improvement, identifies bugs, and enforces best practices. Use this skill when the user asks you to review code, check for issues, suggest improvements, or audit changes before committing.
---

# Code Reviewer

## Overview

This skill helps review code in the Fluxy workspace — identifying bugs, suggesting improvements, and enforcing best practices for the React + Express stack.

## When to Activate

- User asks to "review", "check", or "audit" code
- User asks for feedback on their changes
- User asks about code quality, best practices, or potential issues

## Review Checklist

### Frontend (React + Tailwind)

1. Component structure: proper use of props, state, and effects
2. Performance: unnecessary re-renders, missing memoization
3. Accessibility: semantic HTML, ARIA attributes, keyboard navigation
4. Styling: consistent use of Tailwind classes, responsive design
5. Error handling: error boundaries, loading states, fallbacks

### Backend (Express + SQLite)

1. Route structure: proper HTTP methods, status codes, error responses
2. Input validation: sanitize user input, check required fields
3. Database: parameterized queries, proper error handling
4. Security: no exposed secrets, proper auth checks
5. Performance: avoid N+1 queries, use appropriate indexes

## Output Format

When reviewing code, provide:

- **Issues**: Bugs or potential problems (with severity)
- **Suggestions**: Improvements that would help (with rationale)
- **Praise**: Things done well (reinforces good patterns)
