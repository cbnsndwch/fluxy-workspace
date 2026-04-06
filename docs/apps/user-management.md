# User Management

The User Management app lets you see who has accessed the workspace, assign roles, and control per-app permissions across the team.

## Tabs

### Users
A list of everyone who has logged in via GitHub OAuth. Each row shows their avatar, name, GitHub handle, and current roles. Click **Edit** on any user to open the role assignment panel, where you can toggle roles on or off with a single click.

### Roles & Permissions
Manage the full permission model for the workspace.

**System roles** (`admin`, `operator`) are built-in and cannot be edited or deleted:
- `admin` — full access to everything
- `operator` — chat access only

**Custom roles** can be created freely. Each custom role is a named set of per-app permissions. Click **New Role** to create one, or the pencil icon to edit an existing one. Expand any role row to see its current permissions at a glance.

## Permissions model

Permissions are scoped per app. Available actions per app:

| App | Actions |
|-----|---------|
| CRM | view, edit, delete |
| App Ideas | view, edit, delete |
| Image Studio | view, generate |
| Workflows | view, edit, run, delete |
| DB Viewer | view |
| Docs | view, edit, delete |
| Workspace Issues | view, edit, close |
| User Management | view, manage, roles-edit |
| Chat | access |

A user can hold multiple roles. Their effective permissions are the union of all assigned roles.

## Data model

```
users         — GitHub identity (id, login, name, email, avatar)
roles         — named permission sets (system or custom)
role_permissions — which actions each role grants per app
user_roles    — join table assigning roles to users
```

## API

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/users` | List all users with their roles |
| GET | `/users/:id` | Get a single user |
| PUT | `/users/:id/roles` | Assign roles to a user |
| GET | `/roles` | List all roles with permissions |
| POST | `/roles` | Create a custom role |
| PUT | `/roles/:id` | Update a custom role |
| DELETE | `/roles/:id` | Delete a custom role |

## Tips

- System roles (`admin`, `operator`) cannot be modified — they exist in every workspace.
- A user with no roles assigned has no explicit permissions beyond what the app allows unauthenticated.
- Custom roles are immediately available for assignment after creation — no restart needed.
