# Wedding photos

Password-protected photo gallery. Photos are encrypted (AES-256-GCM, key derived from the
password with PBKDF2) and decrypted in the browser. Originals are attached to the
`originals` release.

Rebuild: `GALLERY_TITLE='…' GALLERY_PASSWORD='…' GITHUB_REPO='aydogankaragoz/wedding' python3 tools/build.py <photo folder>`
