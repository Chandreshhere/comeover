// Reset the ROOT stack (walks up from any nested navigator, e.g. the tab bar).
export function resetTo(navigation, name, params) {
  let root = navigation;
  while (root.getParent && root.getParent()) root = root.getParent();
  root.reset({ index: 0, routes: [{ name, params }] });
}

// Navigate to a bottom-tab screen from anywhere in the tree.
export function goTab(navigation, screen, params) {
  navigation.navigate('main', { screen, params });
}

export function maskPhone(phone) {
  if (!phone) return 'Not set';
  const digits = String(phone).replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length < 5) return phone;
  return `+91 ${local.slice(0, 2)}••• ••${local.slice(-3)}`;
}
