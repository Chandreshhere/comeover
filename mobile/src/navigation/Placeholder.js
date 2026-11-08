import React from 'react';
import { useRoute } from '@react-navigation/native';
import { EmptyState, Screen, ScreenHeader } from '@/components';
import { colors } from '@/theme/tokens';

// Fallback for inventory screens not yet implemented in this build phase.
export default function Placeholder() {
  const route = useRoute();
  return (
    <Screen header={<ScreenHeader title={route.name.replace(/_/g, ' ')} />} bg={colors.canvas}>
      <EmptyState title="Coming in the next phase" body={`Screen "${route.name}" is registered and deep-linkable, but not built yet.`} pose="wave" />
    </Screen>
  );
}
