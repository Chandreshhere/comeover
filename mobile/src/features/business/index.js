// Feature module: business hub (partner venues, perks, sponsorship, analytics).
import BusinessDiscoveryScreen from './BusinessDiscoveryScreen';
import BusinessProfileScreen from './BusinessProfileScreen';
import BusinessOnboardingScreen from './BusinessOnboardingScreen';
import CampaignCreateScreen from './CampaignCreateScreen';
import BusinessAnalyticsScreen from './BusinessAnalyticsScreen';
import MyPerksScreen from './MyPerksScreen';
import OfferRedeemScreen from './OfferRedeemScreen';
import BusinessOffersScreen from './BusinessOffersScreen';
import BusinessRedeemScreen from './BusinessRedeemScreen';
import BusinessHoldsScreen from './BusinessHoldsScreen';

export const screens = {
  business_discovery: BusinessDiscoveryScreen,
  business_profile: BusinessProfileScreen,
  business_onboarding: BusinessOnboardingScreen,
  business_campaign_create: CampaignCreateScreen,
  business_analytics: BusinessAnalyticsScreen,
  // Partner perks
  my_perks: MyPerksScreen,
  offer_redeem: OfferRedeemScreen,
  business_offers: BusinessOffersScreen,
  business_redeem: BusinessRedeemScreen,
  business_holds: BusinessHoldsScreen,
};
