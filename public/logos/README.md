# Swarm logos

Official brand assets, copied unchanged from <https://www.swarm.work/logos>
(brand kit release **2026.1**, published 2026-08-14). Do not edit these files by
hand; re-download them from the brand kit when Swarm ships a new release.

| File                                | Use                                        | Size (viewBox) |
| ----------------------------------- | ------------------------------------------ | -------------- |
| `swarm-lockup-primary-on-light.svg` | Default logo: violet badge, black wordmark | 373 × 96       |
| `swarm-lockup-primary-on-dark.svg`  | Same lockup with a white wordmark          | 373 × 96       |
| `swarm-badge-violet.svg`            | Compact mark for light backgrounds         | 96 × 96        |
| `swarm-badge-white.svg`             | Compact mark for dark backgrounds          | 96 × 96        |

`/favicon.svg` is a copy of `swarm-badge-violet.svg`.

The app never references these paths directly. `src/presentation/shared/SwarmLogo.tsx`
picks the light or dark file for the current theme, so every screen uses the
same component.

SHA-256 checksums, as listed in the brand kit's `manifest.json`:

```
08834cf5ef5d49c6f4f6d55df8a5d2a61f79f78da302b69cb28f2f811e9fea37  swarm-lockup-primary-on-light.svg
fe2159cfee442163262befbd4749e6a935cf26309d69f3a56585175f50ebb72c  swarm-lockup-primary-on-dark.svg
5e15bd063ed1896b2738847ad68d97b55702b9f8e8788eb4748ec1438c55049d  swarm-badge-violet.svg
8af7d9b33e49509b8ef6f35d2c5265d6efeae66948a86dbd2bd413521f6c93e1  swarm-badge-white.svg
```

Verify with `sha256sum public/logos/*.svg`.
