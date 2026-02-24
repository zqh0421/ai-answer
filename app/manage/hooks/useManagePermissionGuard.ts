'use client';

import axios from 'axios';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';

export const useManagePermissionGuard = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const [hasManagePermission, setHasManagePermission] = useState(false);
  const [isPermissionChecking, setIsPermissionChecking] = useState(true);
  const [manageUserId, setManageUserId] = useState('');

  const isDeepLinkMode = searchParams.get('lti_mode') === 'deep_link';
  const launchId = searchParams.get('launch_id');
  const ltiLaunchId = searchParams.get('lti_launch_id');
  const ltiUserId = searchParams.get('lti_user_id');

  const ltiParams = new URLSearchParams();
  if (isDeepLinkMode) {
    ltiParams.set('lti_mode', 'deep_link');
    if (launchId) ltiParams.set('launch_id', launchId);
    if (ltiLaunchId) ltiParams.set('lti_launch_id', ltiLaunchId);
    if (ltiUserId) ltiParams.set('lti_user_id', ltiUserId);
  }
  const ltiQuery = ltiParams.toString() ? `?${ltiParams.toString()}` : '';

  useEffect(() => {
    let cancelled = false;

    if (status === 'loading') {
      setIsPermissionChecking(true);
      return () => {
        cancelled = true;
      };
    }

    const email = session?.user?.email;
    if (!email) {
      setHasManagePermission(false);
      setManageUserId('');
      setIsPermissionChecking(false);
      router.replace(`/manage/noPermission${ltiQuery}`);
      return () => {
        cancelled = true;
      };
    }

    const checkPermission = async () => {
      setIsPermissionChecking(true);
      try {
        const res = await axios.post('/api/admin_auth', { email });
        if (cancelled) return;

        const permitted = res?.data?.permitted === true;
        const resolvedUserId = typeof res?.data?.user_id === 'string' ? res.data.user_id.trim() : '';
        setManageUserId(resolvedUserId);
        setHasManagePermission(permitted);
        if (!permitted) {
          router.replace(`/manage/noPermission${ltiQuery}`);
        }
      } catch (error) {
        console.error('Error checking manage permission:', error);
        if (cancelled) return;
        setHasManagePermission(false);
        setManageUserId('');
        router.replace(`/manage/noPermission${ltiQuery}`);
      } finally {
        if (!cancelled) {
          setIsPermissionChecking(false);
        }
      }
    };

    checkPermission();

    return () => {
      cancelled = true;
    };
  }, [ltiQuery, router, session?.user?.email, status]);

  return {
    hasManagePermission,
    isPermissionChecking: isPermissionChecking || status === 'loading',
    manageUserId,
  };
};
