# Repository history

ContentQuery was extracted from `yangshun/voidpress` on October 21, 2026, at VoidPress commit `0a3ad62`. History filtering ran only in a disposable clone. The original VoidPress commits remain unchanged.

The extraction keeps the entire `content-query/` directory, including the package, all examples, shared files, benchmarks, recorded results, design documents, and website. Its 19 commits begin with `[content-query] core: add typed collections and framework examples` (`e052080` in VoidPress, `d73a5fb` here). The earlier `content-db` implementation is intentionally excluded.

The extracted tip `ccf727d` has exactly the same Git tree as `0a3ad62:content-query` in VoidPress. Authors, commit messages, and timestamps are retained; commit IDs change because repository paths and parent commits change. The [commit map](./history/voidpress-commit-map.txt) records each retained original and extracted commit ID.

Subsequent commits add the standalone Vite+ workspace and remove assumptions about the enclosing VoidPress directory. Benchmark reports retain their original measurements and source revisions; the extraction does not rerun or relabel those measurements. New benchmark runs fingerprint this repository's lockfile and revision. The default Void benchmark now uses the published workspace catalog versions so a fresh checkout does not require a sibling Void repository. Local framework experiments can temporarily link their own Void builds and must record those fingerprints separately.
