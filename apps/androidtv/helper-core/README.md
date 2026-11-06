# helper-core

The stream helper's web server and rules (ADR 0005, decision 13), in package `com.bannertv.helper`: `HelperServer`, `AddressRules`, `Pairing`, `StreamLinks`, `Playlist`, `Base64Url` and `HeaderRules`. It is plain Kotlin on the JVM, with no Android imports, so the unit tests run it as it is.

It is not a Gradle module of its own. Two apps compile the folder as one of their source folders:

- The Android TV app, from `app/build.gradle.kts` (`variant.sources.kotlin`). Its `Protocol` passes the request header rules on to `HeaderRules`, so the player and the helper send the same headers.
- The phone app's `stream-helper` module, from `apps/mobile/modules/stream-helper/android/build.gradle`.

Each app keeps its own thin Android shell: `StreamHelper` (start, stop, state) and `HelperService` (the foreground service and its notification).

The unit tests live with the Android TV app's, in `app/src/test/java/com/bannertv/helper`, and run with `./gradlew testDebugUnitTest` from `apps/androidtv`. Keep this code to Java 17 APIs and Android API 24: the phone builds it with Java 17 and a lower `minSdk`.
