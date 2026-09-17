package blob

import (
	"bytes"
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/example/wiki-graph/backend/internal/config"
)

const defaultContentType = "text/html; charset=utf-8"

// Repo — проекция Page в объектное хранилище. Ключ — uuid, значение — HTML.
// О языке не знает.
type Repo struct {
	client  *s3.Client
	presign *s3.PresignClient
	bucket  string
	ttl     time.Duration
}

func New(cfg *config.Config) (*Repo, error) {
	if cfg.S3Bucket == "" {
		return nil, fmt.Errorf("s3 bucket is empty")
	}
	client := s3.New(s3.Options{
		Region:       cfg.S3Region,
		BaseEndpoint: aws.String(cfg.S3Endpoint),
		Credentials: credentials.NewStaticCredentialsProvider(
			cfg.S3AccessKey, cfg.S3SecretKey, "",
		),
		// Selectel и MinIO работают по path-style адресации.
		UsePathStyle: true,
	})
	return &Repo{
		client:  client,
		presign: s3.NewPresignClient(client),
		bucket:  cfg.S3Bucket,
		ttl:     cfg.S3PresignedTTL,
	}, nil
}

// Put кладёт контент по ключу uuid. Повторный вызов перезаписывает объект —
// это ровно то поведение, которое нужно при повторной вставке страницы.
func (r *Repo) Put(ctx context.Context, uuid string, content []byte, contentType string) error {
	if contentType == "" {
		contentType = defaultContentType
	}
	_, err := r.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(r.bucket),
		Key:         aws.String(uuid),
		Body:        bytes.NewReader(content),
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return fmt.Errorf("s3 put %s: %w", uuid, err)
	}
	return nil
}

// PresignedURL выдаёт временную ссылку на GET объекта.
// При ttl <= 0 берётся значение из конфига.
func (r *Repo) PresignedURL(ctx context.Context, uuid string, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = r.ttl
	}
	req, err := r.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(uuid),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("s3 presign %s: %w", uuid, err)
	}
	return req.URL, nil
}

// TTL — настроенное время жизни ссылки, нужно хендлеру для ответа клиенту.
func (r *Repo) TTL() time.Duration { return r.ttl }

func (r *Repo) Ping(ctx context.Context) error {
	_, err := r.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(r.bucket)})
	if err != nil {
		return fmt.Errorf("s3 head bucket: %w", err)
	}
	return nil
}
