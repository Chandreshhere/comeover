// Shared avatar picker: pick a photo → presigned S3 upload (POST /media/upload-url)
// → returns { key, uri }. Used by profile_setup (onboarding) and profile_edit.
import { useCallback, useState } from 'react';
import { launchImageLibrary } from 'react-native-image-picker';
import { uploadAsset } from '@/services/upload';

export default function useAvatarPicker(initial = {}) {
  const [uri, setUri] = useState(initial.uri || null);
  const [key, setKey] = useState(initial.key || null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const pick = useCallback(async () => {
    setError(null);
    let asset;
    try {
      const res = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1, quality: 0.8, maxWidth: 1024, maxHeight: 1024 });
      if (res.didCancel) return null;
      if (res.errorCode) {
        setError(res.errorCode === 'permission' ? 'Photo access is off. You can keep the illustrated avatar.' : "Couldn't open your photos.");
        return null;
      }
      asset = res.assets?.[0];
    } catch (e) {
      setError("Couldn't open your photos.");
      return null;
    }
    if (!asset?.uri) return null;

    const previous = { uri, key };
    setUri(asset.uri); // optimistic local preview while uploading
    setUploading(true);
    try {
      const up = await uploadAsset(asset, 'avatar');
      setKey(up.key);
      setUri(up.url || asset.uri);
      return { key: up.key, uri: up.url || asset.uri };
    } catch (e) {
      setUri(previous.uri);
      setKey(previous.key);
      setError(
        e.code === 'file_too_large'
          ? 'That photo is over 5 MB. Try a smaller one.'
          : e.code === 'network' || e.code === 'timeout'
          ? 'No connection. Photo not uploaded. Try again.'
          : e.message || 'Photo upload failed. Try again.'
      );
      return null;
    } finally {
      setUploading(false);
    }
  }, [uri, key]);

  const clear = useCallback(() => {
    setUri(null);
    setKey(null);
    setError(null);
  }, []);

  return { uri, key, uploading, error, pick, clear };
}
