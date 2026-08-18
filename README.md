# ava-vitest-snapshot-diff

Diff snapshots between AVA and Vitest.

Useful when migrating a test suite from AVA to Vitest: it compares an AVA
snapshot file with a Vitest snapshot file and reports any keys that are missing
or whose content differs.

## Usage

```sh
npx ava-vitest-snapshot-diff <ava-snapshot.snap> <vitest-snapshot.snap>
```

The arguments may be given in either order, but one must be an AVA snapshot and
the other a Vitest snapshot.

For example:

```sh
npx ava-vitest-snapshot-diff snapshots/foo.js.snap __snapshots__/foo.test.ts.snap
```

Output is either `Snapshots are equivalent!` or a list of differences,
including the first differing line of each mismatched snapshot.

## License

MIT
