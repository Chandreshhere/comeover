#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>
#import <Firebase.h>

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // Push via FCM/APNs — only when GoogleService-Info.plist has been added to the target.
  if ([[NSBundle mainBundle] pathForResource:@"GoogleService-Info" ofType:@"plist"] != nil) {
    [FIRApp configure];
  }
  self.moduleName = @"ProjectIRL";
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

// Deep links: projectirl://activity/detail?id=a1
- (BOOL)application:(UIApplication *)application
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey, id> *)options
{
  return [RCTLinkingManager application:application openURL:url options:options];
}

// Universal links (https://projectirl.app/...)
- (BOOL)application:(UIApplication *)application
    continueUserActivity:(nonnull NSUserActivity *)userActivity
      restorationHandler:(nonnull void (^)(NSArray<id<UIUserActivityRestoring>> *_Nullable))restorationHandler
{
  return [RCTLinkingManager application:application
                   continueUserActivity:userActivity
                     restorationHandler:restorationHandler];
}

// Same ink as the launch screen and the animated JS splash: no white flash.
- (void)customizeRootView:(RCTRootView *)rootView
{
  [super customizeRootView:rootView];
  rootView.backgroundColor = [UIColor colorWithRed:11 / 255.0 green:12 / 255.0 blue:18 / 255.0 alpha:1];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
