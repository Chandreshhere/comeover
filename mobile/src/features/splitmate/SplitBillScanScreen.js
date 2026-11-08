// split_bill_scan — capture a bill (camera or gallery) and enter line items.
// The photo is uploaded privately (POST /media/upload-url → S3, kind "bill")
// and attached to the expense as `receiptKey`. Items are always typed or
// corrected by hand — the flow never depends on automatic reading.
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, TextInput, View } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppText, Button, Card, Icon, IconButton, Screen, ScreenHeader, SectionHeader, TextField } from '@/components';
import { colors, fonts, radius, space } from '@/theme/tokens';
import { uploadAsset } from '@/services/upload';
import { inr } from '@/utils/format';
import { localId, minorToInput, newDraft, toMinor } from './lib/split';
import { Steps } from './components/SplitBits';

const PICKER_OPTS = { mediaType: 'photo', quality: 0.7, maxWidth: 1600, maxHeight: 1600, saveToPhotos: false, includeBase64: false };

function ItemRow({ item, onChange, onRemove, index }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <TextInput
        value={item.name}
        onChangeText={(t) => onChange({ name: t })}
        placeholder={`Item ${index + 1}`}
        placeholderTextColor={colors.muted}
        accessibilityLabel={`Item ${index + 1} name`}
        style={{ flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.ink, paddingVertical: 6 }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSubtle, borderRadius: 12, paddingHorizontal: 10, width: 108, marginLeft: space.xs }}>
        <AppText variant="label" color={colors.muted}>
          ₹
        </AppText>
        <TextInput
          value={item.amountText}
          onChangeText={(t) => onChange({ amountText: t.replace(/[^0-9.]/g, '') })}
          placeholder="0"
          placeholderTextColor={colors.muted}
          keyboardType="decimal-pad"
          accessibilityLabel={`Item ${index + 1} amount in rupees`}
          style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, paddingVertical: 8, marginLeft: 4, textAlign: 'right' }}
        />
      </View>
      <IconButton icon="x" variant="plain" size={36} accessibilityLabel={`Remove item ${index + 1}`} onPress={onRemove} />
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
        setPickError(res.errorCode === 'camera_unavailable' ? 'Camera not available on this device — choose a photo instead.' : res.errorCode === 'permission' ? 'Camera permission is off. You can enable it in Settings, or add items manually.' : 'Couldn’t open the photo. Add items manually below.');
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
          title={uploading ? 'Uploading bill…' : total ? `Assign ${inr(total)}` : 'Assign items'}
          iconRight={uploading ? undefined : 'arrow-right'}
          onPress={next}
          loading={uploading}
          disabled={uploading || (touched && !filled.length)}
        />
      }
    >
      <Steps step={2} />

      {billUri ? (
        <Card padding={8}>
          <View>
            <Image source={{ uri: billUri }} style={{ width: '100%', height: 220, borderRadius: radius.quest, backgroundColor: colors.surfaceSubtle, opacity: uploading ? 0.6 : 1 }} resizeMode="cover" accessibilityLabel="Bill photo" />
            {uploading ? (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={colors.ink} />
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingHorizontal: 4, gap: space.xs }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <Icon name={receiptKey ? 'check-circle' : uploading ? 'upload-cloud' : 'alert-circle'} size={14} color={receiptKey ? colors.success : uploading ? colors.inkSoft : colors.danger} />
              <AppText variant="caption" color={colors.muted} style={{ flex: 1, marginLeft: 6 }}>
                {receiptKey ? 'Attached privately to this split. Read the items off it below.' : uploading ? 'Uploading privately…' : 'Not attached yet.'}
              </AppText>
            </View>
            {!uploading && !receiptKey && lastAsset ? <Button title="Retry" size="xs" variant="secondary" full={false} icon="upload" onPress={() => upload(lastAsset)} /> : null}
            <Button title="Retake" size="xs" variant="secondary" full={false} icon="refresh-cw" disabled={uploading} onPress={() => pick('camera')} />
            <IconButton icon="trash-2" variant="plain" size={36} accessibilityLabel="Remove bill photo" onPress={removePhoto} />
          </View>
        </Card>
      ) : (
        <View style={{ backgroundColor: colors.periwinkle, borderRadius: radius.hero, padding: space.lg, alignItems: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="file-text" size={28} />
          </View>
          <AppText variant="h3" align="center" style={{ marginTop: space.sm }}>
            Snap the bill for reference
          </AppText>
          <AppText variant="caption" align="center" color={colors.inkSoft} style={{ marginTop: 4, maxWidth: 280 }}>
            Optional. It's attached privately to the split so everyone can check the items.
          </AppText>
          <View style={{ flexDirection: 'row', gap: space.xs, marginTop: space.md }}>
            <Button title="Camera" icon="camera" size="sm" full={false} onPress={() => pick('camera')} />
            <Button title="Gallery" icon="image" size="sm" variant="light" full={false} onPress={() => pick('library')} />
          </View>
        </View>
      )}
      {pickError ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: space.xs }} accessibilityLiveRegion="polite">
          {pickError}
        </AppText>
      ) : null}

      <View style={{ flexDirection: 'row', backgroundColor: colors.lavender, borderRadius: radius.quest, padding: space.sm, marginTop: space.md }}>
        <Icon name="edit-3" size={15} style={{ marginTop: 1 }} />
        <AppText variant="caption" color={colors.inkSoft} style={{ flex: 1, marginLeft: space.xs }}>
          Type each item and its price from the bill. You can always correct them before saving.
        </AppText>
      </View>

      <SectionHeader title="Items" right={<AppText variant="label" color={colors.muted}>{inr(subtotal)}</AppText>} />
      <Card padding={12} style={{ paddingTop: 4 }}>
        {items.map((it, i) => (
          <ItemRow key={it.id} item={it} index={i} onChange={(p) => update(it.id, p)} onRemove={() => remove(it.id)} />
        ))}
        <Pressable onPress={add} accessibilityRole="button" accessibilityLabel="Add item" style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={16} color={colors.white} />
          </View>
          <AppText variant="bodyStrong" style={{ marginLeft: space.xs }}>
            Add item
          </AppText>
        </Pressable>
      </Card>
      {touched && !filled.length ? (
        <AppText variant="caption" color={colors.danger} style={{ marginTop: 6 }}>
          Add at least one item with an amount.
        </AppText>
      ) : null}

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        <TextField style={{ flex: 1 }} label="Tax / GST (₹)" value={taxText} onChangeText={(t) => setTaxText(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" />
        <TextField style={{ flex: 1 }} label="Tip / service (₹)" value={tipText} onChangeText={(t) => setTipText(t.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" placeholder="0" />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="h3">Bill total</AppText>
        <AppText variant="h2">{inr(total)}</AppText>
      </View>
    </Screen>
  );
}
