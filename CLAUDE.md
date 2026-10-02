@AGENTS.md

## Checking builds on the phone

When the user's phone is connected over USB, install and check builds on the
phone, not on the emulator. Do not hold back because of local data: if the
debug build cannot install over the release build (different signing key or
a version downgrade), uninstall `ru.listok.purchases` and install anyway. The
user accepts losing the local data on the phone.
