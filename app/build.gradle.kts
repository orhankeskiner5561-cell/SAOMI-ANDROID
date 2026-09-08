plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "com.orhan.shaomi"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.orhan.shaomi.c8"
        minSdk = 26; targetSdk = 35; versionCode = 801; versionName = "C8-1.0"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { viewBinding = true }
}
dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("com.alphacephei:vosk-android:0.3.47")
}
