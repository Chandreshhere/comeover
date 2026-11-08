import React from 'react';
import { View } from 'react-native';
import { AppText, Card, Mascot } from '@/components';
import { colors, radius, space } from '@/theme/tokens';

// Shown when src/config.env.json has no backend values. There is no demo mode.
export default function NotConfigured() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.periwinkle, justifyContent: 'center', padding: space.lg }}>
      <View style={{ alignItems: 'center' }}>
        <Mascot size={180} pose="wave" />
      </View>
      <AppText variant="h1" align="center" style={{ marginTop: space.lg }}>
        Connect a backend
      </AppText>
      <AppText align="center" color={colors.inkSoft} style={{ marginTop: space.xs }}>
        Project IRL talks only to the real API. Deploy the backend, then generate the app config:
      </AppText>
      <Card style={{ marginTop: space.lg, borderRadius: radius.quest }}>
        <AppText variant="label">npm run configure -- --stack irl-prod --region ap-south-1</AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginTop: space.xs }}>
          Writes API_URL, WS_URL, AWS_REGION, COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID into src/config.env.json. Rebuild the app afterwards.
        </AppText>
      </Card>
    </View>
  );
}
