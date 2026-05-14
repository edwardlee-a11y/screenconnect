# Android Manifest Additions

After running `expo prebuild` (ejecting from managed workflow), add these entries to
`android/app/src/main/AndroidManifest.xml`:

Inside `<manifest>`:
```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION"/>
```

Inside `<application>`:
```xml
<service
  android:name="com.oney.WebRTCModule.screencaptureservice.ScreenCaptureService"
  android:foregroundServiceType="mediaProjection"
  android:exported="false"/>
```

These are required for `mediaDevices.getDisplayMedia()` to work on Android.
