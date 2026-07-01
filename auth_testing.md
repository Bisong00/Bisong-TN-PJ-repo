# Auth-Gated App Testing Playbook (MonoNode)

## Step 1: Create Test User & Session
```bash
mongosh test_database --eval "
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Test Backend API
```bash
API=https://no-duplicates-3.preview.emergentagent.com/api

curl -X GET "$API/auth/me" -H "Authorization: Bearer YOUR_SESSION_TOKEN"
curl -X GET "$API/files"  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
curl -X POST "$API/apps" -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
     -d '{"app_name":"Test","version":"1.0","install_path":"/tmp/test","platform":"mac","notes":""}'
```

## Step 3: Browser Testing (Playwright)
```python
await page.context.add_cookies([{
    "name": "session_token",
    "value": "YOUR_SESSION_TOKEN",
    "domain": "no-duplicates-3.preview.emergentagent.com",
    "path": "/",
    "httpOnly": True,
    "secure": True,
    "sameSite": "None"
}])
await page.goto("https://no-duplicates-3.preview.emergentagent.com/")
```

## Cleanup
```bash
mongosh test_database --eval "
db.users.deleteMany({email: /test\.user\./});
db.user_sessions.deleteMany({session_token: /test_session/});
db.files.deleteMany({user_id: /^test-user-/});
db.apps.deleteMany({user_id: /^test-user-/});
db.duplicates.deleteMany({user_id: /^test-user-/});
"
```

## Testids reference
- `google-signin-btn` (login page)
- `logout-btn`
- `user-badge` (top bar shows name)
- `onboarding-banner` (first-run helper on Overview)
- `agent-token-generate` / `agent-token-display` (Scan tab)
- `reclaim-all-posix-btn` / `reclaim-all-windows-btn` (Duplicates tab)

## Success indicators
- ✅ `/api/auth/me` returns user data
- ✅ Two separate users see separate file lists
- ✅ Agent using its token can POST /api/files/scan on behalf of the user
- ✅ Dashboard loads without redirect after Google login
