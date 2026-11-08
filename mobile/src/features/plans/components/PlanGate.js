import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { ErrorState, QueryState, Screen, ScreenHeader } from '@/components';
import { colors, space } from '@/theme/tokens';

// Rendered while a plan isn't in the store yet: skeleton → error/retry →
// "not found" once GET /activities/{id} has answered without a plan.
export default function PlanGate({ title = 'Plan', loader, edges }) {
  const nav = useNavigation();
  const status = loader?.status || 'idle';
  return (
    <Screen bg={colors.canvas} edges={edges} header={<ScreenHeader title={title} />}>
      {status === 'ready' ? (
        <ErrorState kind="api" title="Plan not found" body="It may have been cancelled or removed by moderation." onRetry={() => nav.goBack()} retryLabel="Go back" />
      ) : (
        <QueryState status={status} error={loader?.error} hasData={false} onRetry={loader?.reload} skeletonRows={3} skeletonHeight={120} style={{ marginTop: space.xs }} />
      )}
    </Screen>
  );
}
