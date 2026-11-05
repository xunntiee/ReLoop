import {
  NumberField,
  SelectField,
  TextareaField,
  ToggleField,
} from "./form-controls";
import {
  keywordModeOptions,
  type CrawlFormState,
  type UpdateCrawlForm,
} from "./form-state";

export const CrawlAdvancedOptions = ({
  form,
  mode,
  updateForm,
}: {
  form: CrawlFormState;
  mode: CrawlFormState["sourceMode"];
  updateForm: UpdateCrawlForm;
}) => {
  const hasRequiredKeywords = form.requiredKeywords.trim().length > 0;
  const isSeedOnlyMode = mode === "seed_only";

  if (isSeedOnlyMode) {
    return (
      <div className="grid gap-3 rounded-lg border border-dashed bg-muted/20 p-3">
        <p className="text-xs font-medium text-muted-foreground">Tùy chọn thêm</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Tối thiểu comment tải"
            min={0}
            onChange={(value) => updateForm("minLoadedTopComments", value)}
            value={form.minLoadedTopComments}
          />
          <NumberField
            label="Tối thiểu like comment"
            min={0}
            onChange={(value) => updateForm("minCommentLikes", value)}
            value={form.minCommentLikes}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-lg border border-dashed bg-muted/20 p-3">
      <p className="text-xs font-medium text-muted-foreground">Bộ lọc nâng cao</p>

      <TextareaField
        description="Chỉ nhập khi muốn bắt buộc bài viết phải có đúng các cụm này. Nếu để trống, hệ thống chỉ dựa vào chủ đề và từ khóa hỗ trợ để tìm bài."
        label="Cụm từ bắt buộc phải có"
        onChange={(value) => updateForm("requiredKeywords", value)}
        placeholder={"Ví dụ:\ntiết kiệm\nchứng khoán\nmua nhà"}
        rows={3}
        value={form.requiredKeywords}
      />

      <TextareaField
        description="Mỗi dòng một từ/cụm từ. Bài khớp sẽ bị loại trừ."
        label="Từ khóa loại trừ"
        onChange={(value) => updateForm("excludedKeywords", value)}
        placeholder={"Ví dụ:\nquảng cáo\nmã giảm giá"}
        rows={3}
        value={form.excludedKeywords}
      />

      <SelectField
        description={
          hasRequiredKeywords
            ? 'Nếu nhập "world cup" và "ai": chọn "Phải có tất cả" thì bài phải có cả hai; chọn "Chỉ cần 1 từ khóa" thì có một trong hai là đủ.'
            : "Chưa nhập cụm từ bắt buộc nên tùy chọn này hiện chưa được áp dụng."
        }
        disabled={!hasRequiredKeywords}
        label="Cách dùng cụm từ bắt buộc"
        onChange={(value) => updateForm("requiredKeywordsMode", value as "all" | "any")}
        options={keywordModeOptions}
        value={form.requiredKeywordsMode}
      />

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Top comment mỗi bài"
          min={0}
          onChange={(value) => updateForm("topCommentsPerPost", value)}
          value={form.topCommentsPerPost}
        />
        <NumberField
          label="Tối thiểu comment tải"
          min={0}
          onChange={(value) => updateForm("minLoadedTopComments", value)}
          value={form.minLoadedTopComments}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Tối thiểu phản hồi"
          min={0}
          onChange={(value) => updateForm("minPostReplies", value)}
          value={form.minPostReplies}
        />
        <ToggleField
          checked={form.excludePostsWithLinks}
          label="Loại bài có link"
          onChange={(value) => updateForm("excludePostsWithLinks", value)}
        />
      </div>
      <ToggleField
        checked={form.excludeCommerceContent}
        label="Loại nội dung bán hàng"
        onChange={(value) => updateForm("excludeCommerceContent", value)}
      />

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Tối thiểu like comment"
          min={0}
          onChange={(value) => updateForm("minCommentLikes", value)}
          value={form.minCommentLikes}
        />
        <NumberField
          label="Tối thiểu đăng lại"
          min={0}
          onChange={(value) => updateForm("minPostReposts", value)}
          value={form.minPostReposts}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Tối thiểu chia sẻ"
          min={0}
          onChange={(value) => updateForm("minPostShares", value)}
          value={form.minPostShares}
        />
        <NumberField
          label="Chiều dài chữ tối thiểu"
          min={0}
          onChange={(value) => updateForm("minTextLength", value)}
          value={form.minTextLength}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Chiều dài chữ tối đa"
          min={0}
          onChange={(value) => updateForm("maxTextLength", value)}
          value={form.maxTextLength}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Các bộ lọc chỉ được áp dụng khi bật phần nâng cao. Comment chứa link vẫn tự bị bỏ qua.
      </p>
    </div>
  );
};
