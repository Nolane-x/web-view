# Enable the GitHub Pages deployment

The application and deployment workflow are already committed. GitHub requires a repository administrator to enable Pages once; the standard Actions GITHUB_TOKEN cannot create the Pages site.

1. Open the repository Settings: https://github.com/Nolane-x/web-view/settings/pages
2. In **Build and deployment**, set **Source** to **GitHub Actions**.
3. Return to the Actions tab. The next push to main will deploy automatically, or re-run the latest **Deploy Nolane Infinite to GitHub Pages** workflow.

The workflow itself uses the least permissions needed for artifact deployment: contents read, Pages write and ID-token write. It does not request a personal access token or repository administration token.
