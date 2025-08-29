# Foundry VTT Package Release API Setup

This guide explains how to configure automatic publishing to the Foundry VTT Package Listing when you create a GitHub release.

## Prerequisites

1. A Foundry VTT account with a package listing
2. Your module must already be listed on the Foundry VTT package directory

## Setup Instructions

### Step 1: Get Your Foundry API Key

1. Log in to your Foundry VTT account
2. Navigate to [https://foundryvtt.com/me/api](https://foundryvtt.com/me/api)
3. Generate or copy your existing API key
4. Keep this key secure - it provides access to manage your packages

### Step 2: Add the API Key to GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Create a new secret:
   - **Name**: `FOUNDRY_RELEASE_TOKEN`
   - **Value**: Your Foundry API key from Step 1
5. Click **Add secret**

### Step 3: Verify Your Module Setup

Ensure your `module.json` contains:

```json
{
  "id": "bardic-inspiration",
  "title": "Bardic Inspiration",
  "compatibility": {
    "minimum": "11",
    "verified": "13",
    "maximum": "13"
  }
}
```

The workflow will automatically extract these values for the API submission.

## How It Works

When you create a new release on GitHub:

1. The workflow validates your module structure and manifest
2. It builds and packages your module
3. It uploads the `module.json` and `module.zip` to the GitHub release
4. If `FOUNDRY_RELEASE_TOKEN` is configured, it submits the release to Foundry's Package API
5. The release becomes immediately available in Foundry VTT's package installer

## Creating a Release

### Automated Release Process

1. Update your module version in `package.json`
2. Run `npm run version:bump` to sync versions
3. Commit your changes
4. Create a new release on GitHub:
   ```bash
   git tag v1.0.2
   git push origin v1.0.2
   ```
5. Go to GitHub → Releases → Draft a new release
6. Select your tag and publish

### What Happens During Release

The workflow will:
- ✅ Validate module.json structure
- ✅ Check version consistency
- ✅ Build the module
- ✅ Create module.zip archive
- ✅ Upload assets to GitHub release
- ✅ Submit to Foundry Package API (if token configured)
- ✅ Generate changelog

## API Response Handling

### Success Response
```json
{
  "status": "success",
  "message": "Release created successfully"
}
```

### Error Handling
The workflow will fail and show the error if:
- Invalid API token
- Package ID doesn't match your account
- Version already exists
- Invalid compatibility versions

## Troubleshooting

### Common Issues

1. **"Package not found" error**
   - Ensure your module is already listed on Foundry's package directory
   - Verify the package ID matches exactly

2. **"Unauthorized" error**
   - Check your API token is correctly set in GitHub secrets
   - Ensure the token hasn't expired

3. **"Version already exists" error**
   - Each version can only be released once
   - Increment your version number and try again

### Manual API Submission

If automatic submission fails, you can manually submit:

```bash
curl -X POST https://api.foundryvtt.com/_api/packages/release \
  -H "Content-Type: application/json" \
  -H "Authorization: YOUR_API_KEY" \
  -d '{
    "id": "bardic-inspiration",
    "release": {
      "version": "1.0.2",
      "manifest": "https://github.com/journeyjt/BardicInspiration/releases/download/v1.0.2/module.json",
      "notes": "https://github.com/journeyjt/BardicInspiration/releases/tag/v1.0.2",
      "compatibility": {
        "minimum": "11",
        "verified": "13"
      }
    }
  }'
```

## Benefits

- 🚀 **Instant Updates**: Your users get updates immediately
- 📦 **Automated Process**: No manual steps required
- ✅ **Validation**: Ensures your release is properly formatted
- 📊 **Version Tracking**: Foundry tracks all your releases
- 🔄 **Update Notifications**: Users see updates in their Foundry setup

## Security Notes

- Never commit your API key to the repository
- Use GitHub secrets for secure storage
- Rotate your API key periodically
- The API key only has access to your own packages

## Additional Resources

- [Foundry VTT Package API Documentation](https://foundryvtt.com/article/package-release-api/)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Module Development Guide](https://foundryvtt.com/article/module-development/)