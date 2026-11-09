// split_bill_scan — optional bill photo, then line items, tax and tip in one
// aligned money column.
// The photo is uploaded privately (POST /media/upload-url → S3, kind "bill")
// and attached to the expense as `receiptKey`. Items are always typed or
// corrected by hand — the flow never depends on automatic reading.
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, TextInput, View } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Card, ChipGrid, Icon, IconBubble, IconButton, Screen, ScreenHeader, SectionHeader } from '@/components';
import { colors, fonts, isDark, radius, space } from '@/theme/tokens';
import { uploadAsset } from '@/services/upload';
import { localId, minorToInput, money, newDraft, toMinor } from './lib/split';
import { Hint, MoneyInput } from './components/SplitBits';

const PICKER_OPTS = { mediaType: 'photo', quality: 0.7, maxWidth: 1600, maxHeight: 1600, saveToPhotos: false, includeBase64: false };

// Money column shared by item, tax/tip and total rows so every amount lines up.
const AMOUNT_W = 108;
const TRAIL_W = 40; // remove button (or an equal spacer)

function ItemRow({ item, onChange, onRemove, index }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <TextInput
        value={item.name}
        onChangeText={(t) => onChange({ name: t })}
        placeholder={`Item ${index + 1}`}
        placeholderTextColor={colors.muted}
        keyboardAppearance={isDark() ? 'dark' : 'light'}
        accessibilityLabel={`Item ${index + 1} name`}
        style={{ flex: 1, minWidth: 0, height: 44, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, paddingVertical: 0 }}
      />
      <MoneyInput width={AMOUNT_W} value={item.amountText} onChange={(t) => onChange({ amountText: t })} label={`Item ${index + 1} amount in rupees`} />
      <View style={{ width: TRAIL_W, alignItems: 'flex-end' }}>
        <IconButton icon="x" variant="plain" size={36} accessibilityLabel={`Remove item ${index + 1}`} onPress={onRemove} />
      </View>
    </View>
  );
}

// Label + amount input on the same money column as the items.
function ExtraRow({ label, value, onChange }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56 }}>
      <AppText color={colors.inkSoft} style={{ flex: 1 }}>
        {label}
      </AppText>
      <MoneyInput width={AMOUNT_W} value={value} onChange={onChange} label={`${label} in rupees`} />
      <View style={{ width: TRAIL_W }} />
    </View>
  );
}

export default function SplitBillScanScreen() {
  const nav = useNavigation();
  const route = useRoute();
  const base = route.params?.draft || newDraft({ method: 'itemised' });

  const [billUri, setBillUri] = useState(base.billUri);
  const [receiptKey, setReceiptKey] = useState(base.receiptKey || null);
  const [uploading, setUploading] = useState(false);
  const [lastAsset, setLastAsset] = useState(null);
  const [pickError, setPickError] = useState(null);
  const [items, setItems] = useState(
    base.items?.length ? base.items.map((it) => ({ ...it, amountText: minorToInput(it.amountMinor) })) : [{ id: localId(), name: '', amountText: '', assignees: base.participants }]
  );
  const [taxText, setTaxText] = useState(minorToInput(base.taxMinor));
  const [tipText, setTipText] = useState(minorToInput(base.tipMinor));
  const [touched, setTouched] = useState(false);

  const pick = async (source) => {
    setPickError(null);
    try {
      const res = source === 'camera' ? await launchCamera(PICKER_OPTS) : await launchImageLibrary({ ...PICKER_OPTS, selectionLimit: 1 });
      if (res.didCancel) return;
      if (res.errorCode) {
        setPickError(res.errorCode === 'camera_unavailable' ? 'Camera not available on this device. Choose a photo instead.' : res.errorCode === 'permission' ? 'Camera permission is off. You can enable it in Settings, or add items manually.' : 'Couldn’t open the photo. Add items manually below.');
        return;
      }
      const asset = res.assets?.[0];
      if (asset?.uri) {
        setBillUri(asset.uri);
        upload(asset);
      }
    } catch (e) {
      setPickError('Couldn’t open the camera. Add items manually below.');
    }
  };

  const upload = async (asset) => {
    setLastAsset(asset);
    setUploading(true);
    setPickError(null);
    setReceiptKey(null);
    try {
      const { key } = await uploadAsset(asset, 'bill');
      setReceiptKey(key);
    } catch (e) {
      setPickError(e?.code === 'file_too_large' ? 'That photo is too large (max 10 MB). Try a smaller one.' : `${e?.message || 'Upload failed.'} You can retry, or continue without the photo.`);
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = () => {
    setBillUri(null);
    setReceiptKey(null);
    setLastAsset(null);
    setPickError(null);
  };

  const update = (id, p) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const remove = (id) => setItems((list) => (list.length > 1 ? list.filter((it) => it.id !== id) : list.map((it) => ({ ...it, name: '', amountText: '' }))));
  const add = () => setItems((list) => [...list, { id: localId(), name: '', amountText: '', assignees: base.participants }]);

  const filled = items.filter((it) => toMinor(it.amountText) > 0);
  const subtotal = filled.reduce((s, it) => s + toMinor(it.amountText), 0);
  const taxMinor = toMinor(taxText);
  const tipMinor = toMinor(tipText);
  const total = subtotal + taxMinor + tipMinor;

  const next = () => {
    setTouched(true);
    if (!filled.length) return;
    if (uploading) return;
    nav.navigate('split_assign_items', {
      draft: {
        ...base,
        method: 'itemised',
        billUri: receiptKey ? billUri : null,
        receiptKey,
        taxMinor,
        tipMinor,
        items: filled.map((it, i) => ({ id: it.id, name: it.name.trim() || `Item ${i + 1}`, amountMinor: toMinor(it.amountText), assignees: it.assignees?.length ? it.assignees : base.participants })),
      },
    });
  };

  return (
    <Screen
      keyboard
      header={<ScreenHeader title="Bill items" subtitle="Step 2 of 3" />}
      footer={
        <Button
          title={uploading ? 'Uploading bill…' : total ? `Assign ${money(total)}` : 'Assign items'}
          iconRight={uploading ? undefined : 'arrow-right'}
          onPress={next}
          loading={uploading}
          disabled={uploading || (touched && !filled.length)}
        />
      }
    >
      {/* Bill photo (optional) */}
      {billUri ? (
        <Card padding={space.xs} style={{ marginTop: space.xs }}>
          <View>
            <Image source={{ uri: billUri }} style={{ width: '100%', height: 180, borderRadius: radius.quest, backgroundColor: colors.surfaceSubtle, opacity: uploading ? 0.6 : 1 }} resizeMode="cover" accessibilityLabel="Bill photo" />
            {uploading ? (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center' }}>
                  <ActivityIndicator color={colors.pureWhite} />
                </View>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: space.xs, paddingLeft: space.xs }}>
            <Icon name={receiptKey ? 'check-circle' : uploading ? 'upload-cloud' : 'alert-circle'} size={16} color={receiptKey ? colors.success : uploading ? colors.inkSoft : colors.danger} />
            <AppText variant="caption" color={colors.inkSoft} numberOfLines={1} style={{ flex: 1, marginLeft: space.xs }}>
              {receiptKey ? 'Attached privately' : uploading ? 'Uploading privately…' : 'Not attached'}
            </AppText>
            {!uploading && !receiptKey && lastAsset ? <IconButton icon="upload" variant="plain" size={40} accessibilityLabel="Retry upload" onPress={() => upload(lastAsset)} /> : null}
            <IconButton icon="camera" variant="plain" size={40} accessibilityLabel="Retake photo" onPress={() => !uploading && pick('camera')} />
            <IconButton icon="trash-2" variant="plain" size={40} accessibilityLabel="Remove bill photo" onPress={removePhoto} />
          </View>
        </Card>
      ) : (
        <Card style={{ marginTop: space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconBubble size={44} tone="periwinkle" icon="camera" />
            <View style={{ flex: 1, marginLeft: space.sm }}>
              <AppText variant="bodyStrong">Add a bill photo</AppText>
              <AppText variant="caption" color={colors.muted}>
                Optional · private to this split
              </AppText>
            </View>
          </View>
          <ChipGrid columns={2} style={{ marginTop: space.md }}>
            <Button title="Camera" icon="camera" size="sm" variant="secondary" onPress={() => pick('camera')} />
            <Button title="Gallery" icon="image" size="sm" variant="secondary" onPress={() => pick('library')} />
          </ChipGrid>
        </Card>
      )}
      {pickError ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
          {pickError}
        </AppText>
      ) : null}

      {/* Items, tax, tip, total — one money column */}
      <SectionHeader title="Items" right={<AppText variant="label" color={colors.muted}>{money(subtotal)}</AppText>} />
      <Card padding={space.md} style={{ paddingVertical: space.xxs }}>
        {items.map((it, i) => (
          <ItemRow key={it.id} item={it} index={i} onChange={(p) => update(it.id, p)} onRemove={() => remove(it.id)} />
        ))}
        <Pressable onPress={add} accessibilityRole="button" accessibilityLabel="Add item" style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={16} color={colors.white} />
          </View>
          <AppText variant="bodyStrong" style={{ marginLeft: space.xs }}>
            Add item
          </AppText>
        </Pressable>
        <ExtraRow label="Tax / GST" value={taxText} onChange={setTaxText} />
        <ExtraRow label="Tip / service" value={tipText} onChange={setTipText} />
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, borderTopWidth: 1, borderTopColor: colors.border }}>
          <AppText variant="h3" style={{ flex: 1 }}>
            Total
          </AppText>
          <AppText variant="h3" align="right" numberOfLines={1} adjustsFontSizeToFit style={{ width: AMOUNT_W, paddingRight: space.sm }}>
            {money(total)}
          </AppText>
          <View style={{ width: TRAIL_W }} />
        </View>
      </Card>
      {touched && !filled.length ? <Hint tone="warn" style={{ marginTop: space.sm }} title="Add at least one item" body="Give it a price so there's something to split." /> : null}
    </Screen>
  );
}
