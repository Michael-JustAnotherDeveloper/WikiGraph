import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useRandom } from '../api/hooks';
import { ErrorView, LoadingView } from '../components/StateViews';

export function RandomPage() {
  const navigate = useNavigate();
  const { data, error, refetch } = useRandom();

  useEffect(() => {
    if (data?.uuid) {
      navigate(`/page/${data.uuid}`, { replace: true });
    }
  }, [data, navigate]);

  if (error) {
    return (
      <ErrorView
        message={error instanceof ApiError ? error.message : 'Unexpected error'}
        onRetry={() => void refetch()}
      />
    );
  }

  return <LoadingView label="Opening a random article…" />;
}
