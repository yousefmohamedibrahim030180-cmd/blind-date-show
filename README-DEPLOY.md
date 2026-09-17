# Deployment checklist

1. Firebase Console → Authentication → Sign-in method → Anonymous → Enable.
2. Firebase Console → Realtime Database → Rules → replace rules with `database.rules.json` → Publish.
3. GitHub repository → upload all project files to the `main` branch.
4. GitHub → Settings → Pages → Source = GitHub Actions.
5. Wait for the `Deploy to GitHub Pages` workflow to finish.
6. Open the generated Pages URL for participants.
7. Open `<Pages URL>/control.html` for the host controller.
