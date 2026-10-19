# Shared example files

The common stylesheet, browser navigation helper, and static production test utilities live here. The Angular example shares the styles and navigation helper and has its own tests for the native SSR server. Each example includes its own local copy and imports only local application files, so copying an example does not require this directory.

The local copies are hardlinked to these common files in the current workspace. Git records ordinary file contents, so a fresh checkout contains independent copies. Keep those copies synchronized when updating a shared file; `shared-files.test.ts` checks their parity.

From the enclosing VoidPress repository root, run:

```sh
vp test content-query/examples/shared
```
