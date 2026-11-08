// Feature module: plans (detail, join lifecycle, check-in, completion, feedback).
import ActivityDetailScreen from './ActivityDetailScreen';
import JoinRequestScreen from './JoinRequestScreen';
import JoinPendingScreen from './JoinPendingScreen';
import JoinAcceptedScreen from './JoinAcceptedScreen';
import WaitlistScreen from './WaitlistScreen';
import MyActivitiesScreen from './MyActivitiesScreen';
import ActivityCheckinScreen from './ActivityCheckinScreen';
import ActivityCompleteScreen from './ActivityCompleteScreen';
import PostActivityFeedbackScreen from './PostActivityFeedbackScreen';

export const screens = {
  activity_detail: ActivityDetailScreen,
  join_request: JoinRequestScreen,
  join_pending: JoinPendingScreen,
  join_accepted: JoinAcceptedScreen,
  waitlist: WaitlistScreen,
  my_activities: MyActivitiesScreen,
  activity_checkin: ActivityCheckinScreen,
  activity_complete: ActivityCompleteScreen,
  post_activity_feedback: PostActivityFeedbackScreen,
};
