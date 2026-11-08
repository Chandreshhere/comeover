// Feature module: SplitMate (expense ledger + UPI handoff; no custody).
import SplitMateHomeScreen from './SplitMateHomeScreen';
import SplitCreateScreen from './SplitCreateScreen';
import SplitBillScanScreen from './SplitBillScanScreen';
import SplitAssignItemsScreen from './SplitAssignItemsScreen';
import SplitSummaryScreen from './SplitSummaryScreen';
import SplitSettlementScreen from './SplitSettlementScreen';

export const screens = {
  splitmate_home: SplitMateHomeScreen,
  split_create: SplitCreateScreen,
  split_bill_scan: SplitBillScanScreen,
  split_assign_items: SplitAssignItemsScreen,
  split_summary: SplitSummaryScreen,
  split_settlement: SplitSettlementScreen,
};
